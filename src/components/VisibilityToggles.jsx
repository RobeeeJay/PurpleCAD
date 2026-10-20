import { useEffect, useState } from "react";
import { useStore } from "../store";
import SvgIcon from "./icons/SvgIcon.jsx";

// The "Show constraints / Show dimensions" toggle pair shown in place of the
// selection widget while Shift is held (in both the 3D view and sketch mode).
// `className` positions it exactly like the widget it replaces.

const ConstraintsIcon = () => <SvgIcon name="show-constraints" size={18} />;
const DimensionsIcon = () => <SvgIcon name="show-dimensions" size={18} />;

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
