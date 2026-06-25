import React from "react";
import { useStore } from "../store";
import { effectiveSketchSelTypes } from "../store/selectionMode.js";

// Sketch-mode selection-type widget (top-right of the view): choose what a click
// resolves to — Object (only while the Project tool picks 3D geometry), Shape (an
// enclosed area → all its boundary lines), Line, Point, or Constraint.  Ordered to
// match the 3D selection widget (object → region → edge/line → point), so the
// Z/X/C/V/B shortcuts pick the analogous kind in either view.  A tool greys the
// kinds it can't use; the user's choice is restored when it closes.

const LineIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <line
      x1="4"
      y1="19"
      x2="20"
      y2="5"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <circle cx="4" cy="19" r="1.6" fill="currentColor" />
    <circle cx="20" cy="5" r="1.6" fill="currentColor" />
  </svg>
);
const PointIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <circle cx="12" cy="12" r="3.4" fill="currentColor" />
    <circle
      cx="12"
      cy="12"
      r="7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      opacity="0.5"
    />
  </svg>
);
const ShapeIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <polygon
      points="12,3 21,9 17.5,20 6.5,20 3,9"
      fill="currentColor"
      fillOpacity="0.35"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="miter"
    />
  </svg>
);
const ConstraintIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    {/* perpendicular mark */}
    <line
      x1="5"
      y1="20"
      x2="5"
      y2="5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
    />
    <line
      x1="5"
      y1="20"
      x2="20"
      y2="20"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
    />
    <polyline
      points="5,14 11,14 11,20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    />
  </svg>
);
const ObjectIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <polygon
      points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="miter"
    />
    <line
      x1="4"
      y1="7.5"
      x2="12"
      y2="12"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <line
      x1="20"
      y1="7.5"
      x2="12"
      y2="12"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <line
      x1="12"
      y1="12"
      x2="12"
      y2="21"
      stroke="currentColor"
      strokeWidth="1.6"
    />
  </svg>
);

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

  if (!sketchMode) return null;

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
