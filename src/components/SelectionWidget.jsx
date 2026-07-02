import React from "react";
import { useStore } from "../store";
import { effectiveSelectionTypes } from "../store/selectionMode.js";

// The selection widget: four toggle icons at the top-left of the 3D view (clear
// of the Objects/Timeline panel) choosing what a click selects — whole Object,
// or Face / Edge / Point.  Object mode greys the sub-types; a running tool locks
// the set (e.g. extrude → face only).  Hover priority is point > edge > face.

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
const FaceIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18">
    <polygon
      points="5,8 19,5 19,16 5,19"
      fill="currentColor"
      fillOpacity="0.35"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="miter"
    />
  </svg>
);
const EdgeIcon = () => (
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

const SelectionWidget = () => {
  const sketchMode = useStore((s) => {
    const it = s.items.find((i) => i.id === s.selectedId);
    return it?.type === "sketch";
  });
  const selObject = useStore((s) => s.selObject);
  const selFace = useStore((s) => s.selFace);
  const selEdge = useStore((s) => s.selEdge);
  const selPoint = useStore((s) => s.selPoint);
  const selectionOverride = useStore((s) => s.selectionOverride);
  // Tool states the derived lock (Split / Plane) reads.
  const splitTool = useStore((s) => s.splitTool);
  const planeTool = useStore((s) => s.planeTool);
  const planePickActive = useStore((s) => s.planePickActive);
  const holeTool = useStore((s) => s.holeTool);
  const state = {
    selObject,
    selFace,
    selEdge,
    selPoint,
    selectionOverride,
    splitTool,
    planeTool,
    planePickActive,
    holeTool,
  };
  const toggleSelObject = useStore((s) => s.toggleSelObject);
  const toggleSelFace = useStore((s) => s.toggleSelFace);
  const toggleSelEdge = useStore((s) => s.toggleSelEdge);
  const toggleSelPoint = useStore((s) => s.toggleSelPoint);
  const soloSelType = useStore((s) => s.soloSelType);

  // Hidden in sketch mode — it only governs 3D-view selection.
  if (sketchMode) return null;

  const eff = effectiveSelectionTypes(state);
  const locked = eff.overridden; // a tool controls the set
  const btns = [
    {
      key: "object",
      Icon: ObjectIcon,
      on: eff.object,
      toggle: toggleSelObject,
      title: "Select objects",
    },
    {
      key: "face",
      Icon: FaceIcon,
      on: eff.face,
      toggle: toggleSelFace,
      title: "Select faces",
    },
    {
      key: "edge",
      Icon: EdgeIcon,
      on: eff.edge,
      toggle: toggleSelEdge,
      title: "Select edges",
    },
    {
      key: "point",
      Icon: PointIcon,
      on: eff.point,
      toggle: toggleSelPoint,
      title: "Select points (vertices)",
    },
  ];

  return (
    <div className="selection-widget">
      {btns.map(({ key, Icon, on, toggle, title }) => {
        // Sub-types are greyed while Object mode is on; everything is greyed
        // (locked) while a tool forces a set.
        const greyed = locked ? !on : key !== "object" && state.selObject;
        return (
          <button
            key={key}
            type="button"
            className={`selection-widget-btn${on ? " active" : ""}${greyed ? " greyed" : ""}`}
            title={
              locked
                ? `${title} — locked by the active tool`
                : `${title} (⌘/Ctrl-click to isolate)`
            }
            disabled={locked}
            onClick={
              locked
                ? undefined
                : (e) => (e.metaKey || e.ctrlKey ? soloSelType(key) : toggle())
            }
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
};

export default SelectionWidget;
