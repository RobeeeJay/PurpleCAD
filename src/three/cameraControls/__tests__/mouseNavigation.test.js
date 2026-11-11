import { describe, expect, it } from "vitest";
import {
  wheelNotches,
  createMouseNavigation,
  easeZoom,
  looksLikeMouseWheel,
  wheelDevice,
  WHEEL_GESTURE_GAP_MS,
  ZOOM_PER_NOTCH,
} from "../mouseNavigation.js";

// Event shapes as Chromium sends them.
const macTrackpad = { deltaMode: 0, deltaX: 0, deltaY: 3, wheelDeltaY: -9 };
const trackpadDrift = {
  deltaMode: 0,
  deltaX: 1,
  deltaY: 40,
  wheelDeltaY: -120,
};
const mouseNotch = { deltaMode: 0, deltaX: 0, deltaY: 100, wheelDeltaY: -120 };
const firefoxLines = { deltaMode: 1, deltaX: 0, deltaY: 3 };

describe("telling a mouse wheel from a trackpad", () => {
  it("takes a notch of 120 with no sideways movement as a mouse", () => {
    expect(looksLikeMouseWheel(mouseNotch)).toBe(true);
    expect(looksLikeMouseWheel(firefoxLines)).toBe(true);
  });

  it("takes small pixel deltas, or any sideways drift, as a trackpad", () => {
    expect(looksLikeMouseWheel(macTrackpad)).toBe(false);
    expect(looksLikeMouseWheel(trackpadDrift)).toBe(false);
  });

  // A trackpad pan that sends one notch-shaped event must not zoom halfway
  // through: the gesture keeps the device it started as.
  it("keeps a gesture's device across a mouse-shaped event inside it", () => {
    let g = wheelDevice(macTrackpad, null, 0);
    g = wheelDevice(mouseNotch, g, 16);
    expect(g.device).toBe("trackpad");
    g = wheelDevice(mouseNotch, g, 16 + WHEEL_GESTURE_GAP_MS + 1);
    expect(g.device).toBe("mouse");
  });

  it("turns a gesture into a trackpad once it moves sideways", () => {
    let g = wheelDevice(mouseNotch, null, 0);
    expect(g.device).toBe("mouse");
    g = wheelDevice({ ...mouseNotch, deltaX: 2 }, g, 16);
    expect(g.device).toBe("trackpad");
  });

  // Measured in Electron: a real notch down is deltaY +100, wheelDeltaY
  // -120; one built with new WheelEvent({ deltaY: 100 }) has wheelDeltaY
  // +100.  Both must zoom out.
  it("reads a notch's direction from deltaY, whatever wheelDeltaY's sign", () => {
    expect(wheelNotches({ deltaMode: 0, deltaY: 100, wheelDeltaY: -120 })).toBe(
      1,
    );
    expect(wheelNotches({ deltaMode: 0, deltaY: 60, wheelDeltaY: -120 })).toBe(
      1,
    );
    expect(
      wheelNotches({ deltaMode: 0, deltaY: -100, wheelDeltaY: -100 }),
    ).toBeCloseTo(-100 / 120);
  });

  it("lets the setting overrule the guess", () => {
    expect(wheelDevice(mouseNotch, null, 0, "trackpad").device).toBe(
      "trackpad",
    );
    expect(wheelDevice(macTrackpad, null, 0, "mouse").device).toBe("mouse");
  });
});

// A test clock and frame queue, so the eased zoom can be stepped.
function harness(overrides = {}) {
  let t = 0;
  const frames = [];
  const zooms = [];
  const wheels = [];
  const clicks = [];
  const nav = createMouseNavigation({
    onMouseWheel: (e) => wheels.push(e),
    zoomBy: (s) => zooms.push(s),
    rightClick: (e) => clicks.push(e),
    now: () => t,
    raf: (cb) => frames.push(cb),
    cancelRaf: () => {},
    ...overrides,
  });
  const runFrames = () => {
    let n = 0;
    while (frames.length) {
      t += 16;
      frames.shift()();
      n++;
    }
    return n;
  };
  const ev = (e) => ({ ...e, preventDefault() {} });
  return { nav, zooms, wheels, clicks, runFrames, ev };
}

const product = (xs) => xs.reduce((a, b) => a * b, 1);

describe("the mouse wheel zooms smoothly", () => {
  it("eases one notch in over several frames, to exactly one notch", () => {
    const h = harness();
    h.nav.onWheel(h.ev({ ...mouseNotch, deltaY: -100, wheelDeltaY: 120 }));
    expect(h.zooms).toEqual([]); // nothing until the first frame
    const frames = h.runFrames();
    expect(frames, `${frames} frames`).toBeGreaterThan(3);
    expect(h.zooms[0]).toBeLessThan(ZOOM_PER_NOTCH);
    expect(product(h.zooms)).toBeCloseTo(ZOOM_PER_NOTCH, 9);
    expect(h.wheels).toEqual([]);
  });

  it("adds notches that land while it is still easing", () => {
    const h = harness();
    h.nav.onWheel(h.ev(mouseNotch));
    h.nav.onWheel(h.ev(mouseNotch));
    h.runFrames();
    expect(product(h.zooms)).toBeCloseTo(ZOOM_PER_NOTCH ** -2, 9);
  });

  it("leaves trackpad scrolling, and a wheel with a modifier, to the view", () => {
    const h = harness();
    h.nav.onWheel(h.ev(macTrackpad));
    h.nav.onWheel(h.ev({ ...mouseNotch, shiftKey: true }));
    h.runFrames();
    expect(h.zooms).toEqual([]);
    expect(h.wheels.length).toBe(2);
  });

  it("ends the easing however long the frames take", () => {
    let pending = Math.log(ZOOM_PER_NOTCH);
    let total = 0;
    for (let i = 0; i < 100 && pending !== 0; i++) {
      const { apply, rest } = easeZoom(pending, 40);
      total += apply;
      pending = rest;
    }
    expect(pending).toBe(0);
    expect(total).toBeCloseTo(Math.log(ZOOM_PER_NOTCH), 12);
  });
});

describe("dragging with the right button", () => {
  const press = { button: 2, buttons: 2, clientX: 100, clientY: 100 };

  // The view moves with the pointer, as natural scrolling moves content
  // with the fingers, and the modifiers pick pan, orbit or screen pan.
  it("scrolls the view by the drag, keeping the modifiers held", () => {
    const h = harness();
    expect(h.nav.onDown(press)).toBe(true);
    h.nav.onMove({ ...press, clientX: 110, clientY: 95, shiftKey: true });
    h.nav.onMove({ ...press, clientX: 112, clientY: 95, metaKey: true });
    expect(h.wheels.map((w) => [w.deltaX, w.deltaY])).toEqual([
      [-10, 5],
      [-2, -0],
    ]);
    expect(h.wheels[0].shiftKey).toBe(true);
    expect(h.wheels[1].metaKey).toBe(true);
    expect(h.nav.onUp(press)).toBe(true);
    expect(h.clicks).toEqual([]);
  });

  it("treats a press that barely moves as a right click", () => {
    const h = harness();
    h.nav.onDown(press);
    h.nav.onMove({ ...press, clientX: 101, clientY: 101 });
    h.nav.onUp(press);
    expect(h.wheels).toEqual([]);
    expect(h.clicks.length).toBe(1);
  });

  it("stops dragging when the button came up outside the canvas", () => {
    const h = harness();
    h.nav.onDown(press);
    expect(h.nav.onMove({ ...press, buttons: 0, clientX: 150 })).toBe(false);
    expect(h.nav.onMove({ ...press, buttons: 0, clientX: 160 })).toBe(false);
    expect(h.wheels).toEqual([]);
  });

  it("leaves the left button alone", () => {
    const h = harness();
    expect(h.nav.onDown({ ...press, button: 0, buttons: 1 })).toBe(false);
    expect(h.nav.onMove({ ...press, buttons: 1 })).toBe(false);
  });
});
