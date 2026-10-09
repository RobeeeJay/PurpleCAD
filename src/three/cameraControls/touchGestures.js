// Touch and Apple Pencil, turned into what the mouse-driven viewport already
// understands.  Pure: pointer events in, actions out (cameraControls.js wires
// both ends), so every rule below is covered by touchGestures.test.js.
//
// The rules:
// - The Pencil (pointerType "pen") IS the mouse: every press, drag and hover
//   is forwarded, so drawing, dragging geometry and marquees work as they do
//   with a mouse.
// - A finger is for navigating.  A tap is a click (and two quick taps a
//   double-click); a one-finger drag orbits (the wiring pans instead in a
//   sketch); two fingers pan and pinch-zoom; a finger held still opens the
//   long-press menu.
// - A finger that lands on something grabbable (a transform handle: the
//   wiring's grabsAt) drags it like the mouse would.
// - Once a second finger has landed, nothing more happens until every
//   finger is up, so lifting one finger out of a pinch doesn't orbit.

export const TOUCH_SLOP_PX = 10;
export const LONG_PRESS_MS = 500;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 30;

export function createTouchGestures(actions, timers = {}) {
  const setTimer = timers.setTimeout ?? setTimeout;
  const clearTimer = timers.clearTimeout ?? clearTimeout;
  const now = timers.now ?? (() => performance.now());

  const fingers = new Map(); // id -> { x, y }
  let mode = "idle"; // idle | pending | drag | held | mouse | two | after
  let start = null; // the first finger's landing point
  let last = null; // the one finger's last point (pending / drag)
  let pair = null; // { cx, cy, dist } for two fingers
  let holdTimer = null;
  let lastTap = null; // { x, y, t, count }

  const stopHold = () => {
    if (holdTimer != null) clearTimer(holdTimer);
    holdTimer = null;
  };

  const measurePair = () => {
    const [a, b] = [...fingers.values()];
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      dist: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };

  function down(p) {
    if (p.type === "pen") return actions.forward("down", p.x, p.y, 1);
    fingers.set(p.id, { x: p.x, y: p.y });
    if (fingers.size === 1) {
      start = last = { x: p.x, y: p.y };
      if (actions.grabsAt(p.x, p.y)) {
        mode = "mouse";
        actions.forward("move", p.x, p.y, 0);
        actions.forward("down", p.x, p.y, 1);
        return;
      }
      mode = "pending";
      holdTimer = setTimer(() => {
        holdTimer = null;
        if (mode !== "pending") return;
        mode = "held";
        actions.longPress(start.x, start.y);
      }, LONG_PRESS_MS);
      return;
    }
    // A second finger: whatever the first was doing ends here.
    stopHold();
    if (mode === "mouse") actions.forward("up", last.x, last.y, 0);
    if (fingers.size === 2) {
      mode = "two";
      pair = measurePair();
    } else {
      mode = "after";
    }
  }

  function move(p) {
    if (p.type === "pen") return actions.forward("move", p.x, p.y, p.buttons);
    const f = fingers.get(p.id);
    if (!f) return;
    f.x = p.x;
    f.y = p.y;
    if (mode === "mouse") {
      last = { x: p.x, y: p.y };
      return actions.forward("move", p.x, p.y, 1);
    }
    if (mode === "pending") {
      if (Math.hypot(p.x - start.x, p.y - start.y) < TOUCH_SLOP_PX) return;
      stopHold();
      mode = "drag";
      // From the landing point, so the slop isn't lost.
      actions.oneFingerDrag(p.x - start.x, p.y - start.y);
      last = { x: p.x, y: p.y };
      return;
    }
    if (mode === "drag") {
      actions.oneFingerDrag(p.x - last.x, p.y - last.y);
      last = { x: p.x, y: p.y };
      return;
    }
    if (mode === "two" && fingers.size === 2) {
      const next = measurePair();
      if (next.cx !== pair.cx || next.cy !== pair.cy)
        actions.twoFingerPan(next.cx - pair.cx, next.cy - pair.cy);
      if (pair.dist > 0 && next.dist > 0 && next.dist !== pair.dist)
        actions.pinch(next.dist / pair.dist, next.cx, next.cy);
      pair = next;
    }
  }

  function up(p, cancelled = false) {
    if (p.type === "pen") return actions.forward("up", p.x, p.y, 0);
    if (!fingers.has(p.id)) return;
    fingers.delete(p.id);
    if (fingers.size > 0) {
      // Out of a two-finger gesture: wait for the rest to lift.
      if (mode === "two") mode = "after";
      return;
    }
    stopHold();
    const was = mode;
    mode = "idle";
    if (was === "mouse") return actions.forward("up", p.x, p.y, 0);
    if (was === "pending" && !cancelled) {
      const t = now();
      const again =
        lastTap &&
        t - lastTap.t < DOUBLE_TAP_MS &&
        Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < DOUBLE_TAP_PX;
      const count = again ? lastTap.count + 1 : 1;
      lastTap = { x: start.x, y: start.y, t, count };
      actions.tap(start.x, start.y, count);
    }
  }

  return {
    down,
    move,
    up: (p) => up(p, false),
    cancel: (p) => up(p, true),
    // For the wiring: true while fingers are on the glass.
    get active() {
      return fingers.size > 0;
    },
  };
}
