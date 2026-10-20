import { useStore } from "../store";
import { effectiveSketchSelTypes } from "../store/selectionMode.js";
import VisibilityToggles, { useShiftHeld } from "./VisibilityToggles";
import SvgIcon from "./icons/SvgIcon.jsx";

// Sketch-mode selection-type widget (top-right of the view): choose what a click
// resolves to — Object (only while the Project tool picks 3D geometry), Shape (an
// enclosed area → all its boundary lines), Line, Point, or Constraint.  Ordered to
// match the 3D selection widget (object → region → edge/line → point), so the
// Z/X/C/V/B shortcuts pick the analogous kind in either view.  A tool greys the
// kinds it can't use; the user's choice is restored when it closes.

const LineIcon = () => <SvgIcon name="select-edge" size={18} />;
const PointIcon = () => <SvgIcon name="select-point" size={18} />;
const ShapeIcon = () => <SvgIcon name="select-shape" size={18} />;
const ConstraintIcon = () => <SvgIcon name="select-constraint" size={18} />;
const ObjectIcon = () => <SvgIcon name="select-object" size={18} />;

const ICONS = {
  line: LineIcon,
  point: PointIcon,
  shape: ShapeIcon,
  constraint: ConstraintIcon,
  object: ObjectIcon,
};
const TITLES = {
  line: "Select lines / curves",
  point: "Select points (vertices)",
  shape: "Select a shape — click an enclosed area to grab all its lines",
  constraint: "Select constraints",
  object: "Select objects (when projecting 3D geometry)",
};

const SketchSelectionWidget = () => {
  const sketchMode = useStore((s) => {
    const it = s.items.find((i) => i.id === s.selectedId);
    return it?.type === "sketch";
  });
  const sketchSelTypes = useStore((s) => s.sketchSelTypes);
  const projectTool = useStore((s) => s.projectTool);
  const sketchConstraintMode = useStore((s) => s.sketchConstraintMode);
  const toggleSketchSelType = useStore((s) => s.toggleSketchSelType);
  const soloSketchSelType = useStore((s) => s.soloSketchSelType);
  const shiftHeld = useShiftHeld();

  if (!sketchMode) return null;
  // While Shift is held, swap for the constraint/dimension visibility toggles.
  if (shiftHeld)
    return <VisibilityToggles className="sketch-selection-widget" />;

  const { eff, allowed } = effectiveSketchSelTypes({
    sketchSelTypes,
    projectTool,
    sketchConstraintMode,
  });
  const keys = ["object", "shape", "line", "point", "constraint"];

  return (
    <div className="sketch-selection-widget">
      {keys.map((k) => {
        const Icon = ICONS[k];
        const isAllowed = !!allowed[k];
        const on = !!eff[k];
        return (
          <button
            key={k}
            type="button"
            className={`selection-widget-btn${on ? " active" : ""}${
              !isAllowed ? " greyed" : ""
            }`}
            title={
              isAllowed
                ? `${TITLES[k]} (⌘/Ctrl-click to isolate)`
                : `${TITLES[k]} — not available for this tool`
            }
            disabled={!isAllowed}
            onClick={
              isAllowed
                ? (e) =>
                    e.metaKey || e.ctrlKey
                      ? soloSketchSelType(k)
                      : toggleSketchSelType(k)
                : undefined
            }
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
};

export default SketchSelectionWidget;
