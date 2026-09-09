import { useEffect, useState } from "react";
import { useStore } from "../store";

// The "Show constraints / Show dimensions" toggle pair shown in place of the
// selection widget while Shift is held (in both the 3D view and sketch mode).
// `className` positions it exactly like the widget it replaces.

const ConstraintsIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <circle
      cx="12"
      cy="12"
      r="4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <line
      x1="12"
      y1="8"
      x2="12"
      y2="3"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <line
      x1="12"
      y1="16"
      x2="12"
      y2="21"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <line
      x1="8"
      y1="12"
      x2="3"
      y2="12"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <line
      x1="16"
      y1="12"
      x2="21"
      y2="12"
      stroke="currentColor"
      strokeWidth="1.6"
    />
  </svg>
);
const DimensionsIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <line
      x1="4"
      y1="6"
      x2="4"
      y2="18"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <line
      x1="20"
      y1="6"
      x2="20"
      y2="18"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <line
      x1="4"
      y1="12"
      x2="20"
      y2="12"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <polygon points="4,12 8,10 8,14" fill="currentColor" />
    <polygon points="20,12 16,10 16,14" fill="currentColor" />
  </svg>
);

// True while Shift is held.  A window blur resets it so it can't get stuck
// "held" if focus leaves mid-press.
export function useShiftHeld() {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (e) => e.key === "Shift" && setHeld(true);
    const up = (e) => e.key === "Shift" && setHeld(false);
    const blur = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
  return held;
}

const VisibilityToggles = ({ className }) => {
  const constraintsVisible = useStore((s) => s.constraintsVisible);
  const toggleConstraintsVisible = useStore((s) => s.toggleConstraintsVisible);
  const dimensionsVisible = useStore((s) => s.dimensionsVisible);
  const toggleDimensionsVisible = useStore((s) => s.toggleDimensionsVisible);
  const btns = [
    {
      key: "constraints",
      Icon: ConstraintsIcon,
      on: constraintsVisible,
      toggle: toggleConstraintsVisible,
      title: "Show constraints",
    },
    {
      key: "dimensions",
      Icon: DimensionsIcon,
      on: dimensionsVisible,
      toggle: toggleDimensionsVisible,
      title: "Show dimensions",
    },
  ];
  return (
    <div className={className}>
      {btns.map(({ key, Icon, on, toggle, title }) => (
        <button
          key={key}
          type="button"
          className={`selection-widget-btn${on ? " active" : ""}`}
          title={`${title} (${on ? "on" : "off"})`}
          onClick={toggle}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
};

export default VisibilityToggles;
