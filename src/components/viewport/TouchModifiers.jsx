// An on-screen Shift for a finger or the Apple Pencil, which have no key to
// hold: Shift-click to add to a selection, Shift-drag to lock a sketch drag to
// one axis.  touchInput.js puts it on the events it makes.  Shown only where
// the screen takes touch.
import { useStore } from "../../store";

const hasTouch =
  typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;

export default function TouchModifiers() {
  const touchShift = useStore((s) => s.touchShift);
  const toggleTouchShift = useStore((s) => s.toggleTouchShift);
  if (!hasTouch) return null;
  return (
    <div className="touch-modifiers">
      <button
        className={touchShift ? "active" : ""}
        aria-pressed={touchShift}
        title="Shift: add to the selection, or lock a drag to one axis"
        onClick={toggleTouchShift}
      >
        Shift
      </button>
    </div>
  );
}
