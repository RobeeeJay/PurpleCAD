// Fingers and the Apple Pencil, through the gesture rules (touchGestures.js),
// into the viewport's own mouse and wheel handlers -- one input path, not a
// second: an orbit is the Shift+wheel orbit, with its pivot anchoring, a pan
// is the wheel's pan.  The mouse, and an iPad trackpad's pointer, keep their
// own listeners; this takes only pointerType "touch" and "pen".
import { createTouchGestures } from "./touchGestures.js";
import { useStore } from "../../store";

export function attachTouchInput(
  el,
  {
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseWheel,
    zoomBy,
    sketchModeRef,
    handleAt,
    bodyAt,
    openLongPressMenuAt,
    home,
  },
) {
  // A mouse event as the handlers read one.  Shift comes from the on-screen
  // toggle (TouchModifiers.jsx): there is no key to hold.
  const mouse = (x, y, buttons) => ({
    clientX: x,
    clientY: y,
    button: 0,
    buttons,
    shiftKey: useStore.getState().touchShift === true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: el,
    preventDefault() {},
    stopPropagation() {},
  });
  // Content follows the finger, as a trackpad's natural scrolling moves it.
  const wheel = (dx, dy, shiftKey) =>
    onMouseWheel({
      deltaX: -dx,
      deltaY: -dy,
      shiftKey,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault() {},
    });
  const click = (x, y) => {
    onMouseMove(mouse(x, y, 0)); // the hover a click relies on
    onMouseDown(mouse(x, y, 1));
    onMouseUp(mouse(x, y, 0));
  };

  const gestures = createTouchGestures({
    forward(kind, x, y, buttons) {
      if (kind === "down") onMouseDown(mouse(x, y, buttons));
      else if (kind === "move") onMouseMove(mouse(x, y, buttons));
      else onMouseUp(mouse(x, y, 0));
    },
    // Orbit in 3D; a sketch is flat, so there it pans.
    oneFingerDrag: (dx, dy) => wheel(dx, dy, !sketchModeRef.current),
    twoFingerPan: (dx, dy) => wheel(dx, dy, false),
    pinch: (scale) => zoomBy(scale),
    tap(x, y, count) {
      // A double tap on empty space frames the model, as the Home button
      // does; on a body (or in a sketch) it is a double click.
      if (count === 2 && !sketchModeRef.current && !bodyAt(x, y)) return home();
      click(x, y);
    },
    longPress(x, y) {
      if (sketchModeRef.current) openLongPressMenuAt(x, y);
    },
    grabsAt: (x, y) => !sketchModeRef.current && handleAt(x, y),
  });

  const touchish = (e) => e.pointerType === "touch" || e.pointerType === "pen";
  const point = (e) => ({
    id: e.pointerId,
    type: e.pointerType,
    x: e.clientX,
    y: e.clientY,
    buttons: e.buttons,
  });
  const onDown = (e) => {
    if (!touchish(e)) return;
    e.preventDefault();
    // Keep the moves coming when a drag leaves the canvas (over a panel).
    // Capture throws for a pointer the browser no longer counts as down -- one
    // lifted before this handler ran, or a synthetic one (e2e) -- and the
    // gesture works without it.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable: see above */
    }
    gestures.down(point(e));
  };
  const onMove = (e) => {
    if (touchish(e)) gestures.move(point(e));
  };
  const onUp = (e) => {
    if (touchish(e)) gestures.up(point(e));
  };
  const onCancel = (e) => {
    if (touchish(e)) gestures.cancel(point(e));
  };
  // WebKit follows a tap with compatibility mouse events, which would click a
  // second time; cancelling touchstart stops them.
  const onTouchStart = (e) => e.preventDefault();

  // No browser scrolling, zooming or text selection on the canvas: every
  // gesture is the viewport's.
  el.style.touchAction = "none";
  el.style.webkitUserSelect = "none";
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onCancel);
  el.addEventListener("touchstart", onTouchStart, { passive: false });
  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onCancel);
    el.removeEventListener("touchstart", onTouchStart);
  };
}
