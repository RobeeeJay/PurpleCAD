// The iPad's touch and Pencil rules (touchGestures.js): the viewport stays
// mouse-driven, and this decides what each finger and the Pencil mean.  A
// mistake here is felt at once -- a tap that orbits, a pinch that ends in a
// jolt of rotation -- and can't be seen in a desktop e2e run.
import { describe, it, expect, beforeEach } from "vitest";
import {
  createTouchGestures,
  TOUCH_SLOP_PX,
  LONG_PRESS_MS,
  DOUBLE_TAP_MS,
} from "../touchGestures.js";

let log;
let clock;
let timers;
let grabbable;
let g;

beforeEach(() => {
  log = [];
  clock = 0;
  grabbable = false;
  const pending = [];
  timers = {
    now: () => clock,
    setTimeout: (fn, ms) => {
      pending.push({ fn, at: clock + ms });
      return pending.length - 1;
    },
    clearTimeout: (id) => {
      if (pending[id]) pending[id].fn = null;
    },
    advance(ms) {
      clock += ms;
      for (const t of pending)
        if (t.fn && t.at <= clock) {
          const fn = t.fn;
          t.fn = null;
          fn();
        }
    },
  };
  const rec =
    (name) =>
    (...args) =>
      log.push([
        name,
        ...args.map((v) => (typeof v === "number" ? +v.toFixed(3) : v)),
      ]);
  g = createTouchGestures(
    {
      forward: rec("forward"),
      oneFingerDrag: rec("drag"),
      twoFingerPan: rec("pan"),
      pinch: rec("pinch"),
      tap: rec("tap"),
      longPress: rec("longPress"),
      grabsAt: () => grabbable,
    },
    timers,
  );
});

const finger = (id, x, y) => ({ id, type: "touch", x, y, buttons: 1 });
const pen = (x, y, buttons = 1) => ({ id: 99, type: "pen", x, y, buttons });

describe("iPad touch and Pencil gestures", () => {
  it("forwards the Pencil as the mouse, hover included", () => {
    g.move(pen(5, 5, 0)); // hovering, not touching
    g.down(pen(10, 10));
    g.move(pen(40, 10));
    g.up(pen(40, 10, 0));
    expect(log).toEqual([
      ["forward", "move", 5, 5, 0],
      ["forward", "down", 10, 10, 1],
      ["forward", "move", 40, 10, 1],
      ["forward", "up", 40, 10, 0],
    ]);
  });

  it("makes a still finger lifted a tap -- a click, not an orbit", () => {
    g.down(finger(1, 100, 100));
    g.move(finger(1, 100 + TOUCH_SLOP_PX - 1, 100)); // a wobble inside the slop
    g.up(finger(1, 100 + TOUCH_SLOP_PX - 1, 100));
    expect(log).toEqual([["tap", 100, 100, 1]]);
  });

  it("counts a quick second tap in the same place as a double tap", () => {
    for (const x of [100, 105]) {
      g.down(finger(1, x, 100));
      g.up(finger(1, x, 100));
      timers.advance(DOUBLE_TAP_MS - 50);
    }
    timers.advance(DOUBLE_TAP_MS); // too late for a third
    g.down(finger(1, 105, 100));
    g.up(finger(1, 105, 100));
    expect(log).toEqual([
      ["tap", 100, 100, 1],
      ["tap", 105, 100, 2],
      ["tap", 105, 100, 1],
    ]);
  });

  it("orbits with one finger once it passes the slop, from where it landed", () => {
    g.down(finger(1, 100, 100));
    g.move(finger(1, 100 + TOUCH_SLOP_PX + 2, 100));
    g.move(finger(1, 130, 90));
    g.up(finger(1, 130, 90));
    expect(log).toEqual([
      ["drag", TOUCH_SLOP_PX + 2, 0],
      ["drag", 130 - (100 + TOUCH_SLOP_PX + 2), -10],
    ]);
  });

  it("opens the long-press menu for a finger held still, and nothing after", () => {
    g.down(finger(1, 50, 60));
    timers.advance(LONG_PRESS_MS);
    g.move(finger(1, 90, 60)); // drifting after the menu opened
    g.up(finger(1, 90, 60));
    expect(log).toEqual([["longPress", 50, 60]]);
  });

  it("drags a grabbable handle with a finger, as the mouse would", () => {
    grabbable = true;
    g.down(finger(1, 10, 10));
    g.move(finger(1, 30, 10));
    g.up(finger(1, 30, 10));
    expect(log).toEqual([
      ["forward", "move", 10, 10, 0],
      ["forward", "down", 10, 10, 1],
      ["forward", "move", 30, 10, 1],
      ["forward", "up", 30, 10, 0],
    ]);
  });

  it("pans and pinches with two fingers, and the first finger never taps", () => {
    g.down(finger(1, 100, 100));
    g.down(finger(2, 200, 100));
    g.move(finger(2, 300, 100)); // spread: centre moves 50, distance doubles
    g.up(finger(1, 100, 100));
    g.up(finger(2, 300, 100));
    expect(log).toEqual([
      ["pan", 50, 0],
      ["pinch", 2, 200, 100],
    ]);
  });

  it("does not orbit when one finger lifts out of a pinch and the other moves", () => {
    g.down(finger(1, 100, 100));
    g.down(finger(2, 200, 100));
    g.up(finger(2, 200, 100));
    g.move(finger(1, 160, 100));
    g.up(finger(1, 160, 100));
    expect(log).toEqual([]);
  });

  it("lets go of a dragged handle when a second finger lands", () => {
    grabbable = true;
    g.down(finger(1, 10, 10));
    g.move(finger(1, 20, 10));
    g.down(finger(2, 80, 10));
    expect(log.at(-1)).toEqual(["forward", "up", 20, 10, 0]);
  });

  it("treats a cancelled touch as no tap at all", () => {
    g.down(finger(1, 10, 10));
    g.cancel(finger(1, 10, 10));
    expect(log).toEqual([]);
    expect(g.active).toBe(false);
  });

  it("keeps the Pencil drawing while fingers navigate", () => {
    g.down(pen(10, 10));
    g.down(finger(1, 100, 100));
    g.move(finger(1, 140, 100));
    g.move(pen(20, 10));
    g.up(finger(1, 140, 100));
    g.up(pen(20, 10, 0));
    expect(log).toEqual([
      ["forward", "down", 10, 10, 1],
      ["drag", 40, 0],
      ["forward", "move", 20, 10, 1],
      ["forward", "up", 20, 10, 0],
    ]);
  });
});
