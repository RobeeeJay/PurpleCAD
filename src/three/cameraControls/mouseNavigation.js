// A mouse, as against a trackpad: its wheel zooms, smoothly, and dragging
// with the right button does what scrolling on a trackpad does -- pans, orbits
// with Shift, pans on the screen plane with Cmd (Ctrl off a Mac).  The drag is
// fed to the wheel handler as the scroll a trackpad would have sent, so the
// two cannot drift apart, as touchInput.js does for fingers.
//
// The browser does not say which device a wheel event came from, so
// `wheelDevice` guesses, once per gesture; the "Scroll wheel" setting
// overrides the guess for hardware it gets wrong.

// Events closer together than this belong to one gesture, which keeps the
// device it started as: a trackpad scroll that happens to send one
// mouse-shaped event must not zoom in the middle of a pan.
export const WHEEL_GESTURE_GAP_MS = 300;
// One wheel notch zooms by this factor.
export const ZOOM_PER_NOTCH = 1.15;
// The eased zoom closes this fraction of the remaining distance every 16 ms.
const ZOOM_EASE_TAU_MS = 70;
// A right press that moves less than this is a click, not a drag.
export const RIGHT_DRAG_SLOP_PX = 3;

// Whether one event, on its own, looks like a notched mouse wheel.  Chromium
// reports a notch as a multiple of 120 in `wheelDeltaY`, and only vertically;
// a trackpad scrolls in pixels, usually with some sideways drift, and its
// first events are small.  Line or page mode is a wheel on every platform.
export function looksLikeMouseWheel(e) {
  if (e.deltaMode !== 0) return true;
  if (e.deltaX !== 0) return false;
  const w = e.wheelDeltaY;
  return typeof w === "number" && w !== 0 && w % 120 === 0;
}

// Classifies `e` given the gesture so far ({ device, t } or null); returns the
// new gesture state.  `preference` is the setting: "auto", "mouse" or
// "trackpad".
export function wheelDevice(e, gesture, now, preference = "auto") {
  if (preference === "mouse" || preference === "trackpad")
    return { device: preference, t: now };
  if (gesture && now - gesture.t < WHEEL_GESTURE_GAP_MS) {
    // Sideways movement is a trackpad, whatever the gesture started as.
    const device = e.deltaX !== 0 ? "trackpad" : gesture.device;
    return { device, t: now };
  }
  return { device: looksLikeMouseWheel(e) ? "mouse" : "trackpad", t: now };
}

// How many notches an event is: positive scrolls down, which zooms OUT.  The
// size comes from `wheelDeltaY` (120 a notch) and the direction from
// `deltaY`: a WheelEvent built in page code copies deltaY's sign into
// wheelDeltaY, where a real one has the opposite sign.
export function wheelNotches(e) {
  if (typeof e.wheelDeltaY === "number" && e.wheelDeltaY !== 0)
    return (Math.sign(e.deltaY) * Math.abs(e.wheelDeltaY)) / 120;
  if (e.deltaMode === 1) return e.deltaY / 3; // lines; three to a notch
  if (e.deltaMode === 2) return e.deltaY; // pages
  return e.deltaY / 100;
}

// One frame of the eased zoom: how much of the outstanding log-scale to apply
// after `dtMs`, and what is left.  Snaps the tail so the animation ends.
export function easeZoom(pendingLog, dtMs) {
  const step = pendingLog * (1 - Math.exp(-dtMs / ZOOM_EASE_TAU_MS));
  const rest = pendingLog - step;
  if (Math.abs(rest) < 1e-4) return { apply: pendingLog, rest: 0 };
  return { apply: step, rest };
}

// A right-button drag of (dx, dy) pixels as the wheel event a trackpad would
// send: content follows the pointer, as with natural scrolling.
export const dragAsWheel = (dx, dy, e) => ({
  deltaX: -dx,
  deltaY: -dy,
  deltaMode: 0,
  shiftKey: e.shiftKey,
  ctrlKey: e.ctrlKey,
  metaKey: e.metaKey,
  altKey: e.altKey,
  preventDefault() {},
});

export function createMouseNavigation({
  onMouseWheel,
  zoomBy,
  rightClick,
  preference = () => "auto",
  now = () => performance.now(),
  raf = (cb) => requestAnimationFrame(cb),
  cancelRaf = (id) => cancelAnimationFrame(id),
}) {
  let gesture = null;
  let pendingLog = 0;
  let frame = null;
  let lastFrameAt = 0;
  let drag = null; // { x, y, moved } while the right button is down

  const tick = () => {
    const t = now();
    const { apply, rest } = easeZoom(pendingLog, Math.max(1, t - lastFrameAt));
    lastFrameAt = t;
    pendingLog = rest;
    zoomBy(Math.exp(apply));
    frame = pendingLog === 0 ? null : raf(tick);
  };

  const onWheel = (e) => {
    gesture = wheelDevice(e, gesture, now(), preference());
    // A modifier keeps its trackpad meaning (Ctrl is a Mac pinch, Shift an
    // orbit, Cmd a screen pan): only the bare wheel zooms.
    const bare = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (gesture.device !== "mouse" || !bare) return onMouseWheel(e);
    e.preventDefault();
    pendingLog -= wheelNotches(e) * Math.log(ZOOM_PER_NOTCH);
    if (frame == null) {
      lastFrameAt = now() - 16;
      frame = raf(tick);
    }
  };

  // Each returns true when it handled the event, so the caller skips the
  // left-button work.
  const onDown = (e) => {
    if (e.button !== 2) return false;
    drag = { x: e.clientX, y: e.clientY, moved: false };
    return true;
  };
  const onMove = (e) => {
    if (!drag) return false;
    // Released outside the canvas, where its mouseup never reached us.
    if ((e.buttons & 2) === 0) {
      drag = null;
      return false;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < RIGHT_DRAG_SLOP_PX) return true;
    drag = { x: e.clientX, y: e.clientY, moved: true };
    onMouseWheel(dragAsWheel(dx, dy, e));
    return true;
  };
  const onUp = (e) => {
    if (e.button !== 2 || !drag) return false;
    const clicked = !drag.moved;
    drag = null;
    if (clicked) rightClick(e);
    return true;
  };

  const dispose = () => {
    if (frame != null) cancelRaf(frame);
    frame = null;
  };

  return { onWheel, onDown, onMove, onUp, dispose };
}
