import React from "react";
import { useStore } from "../../store";
import { maxItemId } from "../../store/internals.js";
import ToolbarSection from "./ToolbarSection";
import SweepSection from "./SweepSection";

const ObjectCreateSection = () => {
  const addItem = useStore((s) => s.addItem);
  const history = useStore((s) => s.history);
  const setSketchPlacementMode = useStore((s) => s.setSketchPlacementMode);
  const extrudeSelectMode = useStore((s) => s.extrudeSelectMode);
  const setExtrudeSelectMode = useStore((s) => s.setExtrudeSelectMode);
  const selectedSubGeometry = useStore((s) => s.selectedSubGeometry);
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const startPlaneTool = useStore((s) => s.startPlaneTool);

  const hasFaceSelected = (selectedSubGeometry?.faces?.length ?? 0) > 0;

  // Open the Plane dialog seeded from the selected sketch's plane, else world
  // XY.  The dialog also offers axis-plane bases and "Pick 3 points".
  const handlePlane = () => {
    const sel = items.find((i) => i.id === selectedId);
    startPlaneTool(
      sel?.type === "sketch"
        ? { position: { ...sel.position }, rotation: { ...sel.rotation } }
        : { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    );
  };

  const handleExtrudeClick = () => {
    if (extrudeSelectMode) {
      // Toggling the tool off mid-extrude must also clear the live preview +
      // selection, not just the mode flag.
      const cc = useStore.getState()._cameraControls;
      if (cc?.cancelExtrude) cc.cancelExtrude();
      else setExtrudeSelectMode(null);
      return;
    }
    // A selected solid face extrudes directly along its normal — no need to
    // re-pick it in profile-select mode.
    if (hasFaceSelected) {
      const started = useStore
        .getState()
        ._cameraControls?.extrudeSelectedFace?.();
      if (started) return;
    }
    setExtrudeSelectMode("profile");
  };

  const createItem = (type) => {
    const id = maxItemId(history) + 1;
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    // Spawn at the current view centre (camera target) so the object appears
    // where the user is looking; fall back to a sensible default if the
    // viewport handle isn't ready.
    const t = useStore.getState()._cameraControls?.getViewTarget?.();
    const position = t ? { x: t.x, y: t.y, z: t.z } : { x: 0, y: 2, z: 0 };
    addItem({
      id,
      name: `${label} ${id}`,
      type,
      children: [],
      position,
      scale: { x: 1, y: 1, z: 1 },
    });
  };

  return (
    <ToolbarSection label="Create">
      <button
        className="toolbar-btn"
        title="Sketch Plane"
        onClick={() => setSketchPlacementMode(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <polygon
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="miter"
            points="2,19 8,13 22,13 16,19"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="2"
            y1="19"
            x2="22"
            y2="13"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="8"
            y1="13"
            x2="16"
            y2="19"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="16"
            x2="12"
            y2="8"
          />
          <polygon
            fill="#6C3FD4"
            stroke="#6C3FD4"
            strokeWidth="0.5"
            points="12,5 10.5,8.5 13.5,8.5"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="12" cy="16" />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Cube"
        onClick={() => createItem("cube")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            x="3"
            y="7"
            width="14"
            height="14"
          />
          <polyline
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="3,7 7,3 21,3 21,17 17,21"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="17"
            y1="7"
            x2="17"
            y2="21"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="3"
            y1="7"
            x2="17"
            y2="7"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="7"
            y1="3"
            x2="7"
            y2="17"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeDasharray="2 1.5"
            x1="21"
            y1="3"
            x2="7"
            y2="17"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Sphere"
        onClick={() => createItem("sphere")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            cx="12"
            cy="12"
            r="9"
          />
          <ellipse
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            cx="12"
            cy="12"
            rx="9"
            ry="3.5"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x1="3"
            y1="12"
            x2="21"
            y2="12"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Cylinder"
        onClick={() => createItem("cylinder")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <ellipse
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            cx="12"
            cy="7"
            rx="8"
            ry="3"
          />
          <ellipse
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            cx="12"
            cy="17"
            rx="8"
            ry="3"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="4"
            y1="7"
            x2="4"
            y2="17"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="20"
            y1="7"
            x2="20"
            y2="17"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="12"
            y1="7"
            x2="12"
            y2="17"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Torus"
        onClick={() => createItem("torus")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            cx="12"
            cy="12"
            r="9"
          />
          <circle
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2.5"
            cx="12"
            cy="12"
            r="4"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="3"
            y1="12"
            x2="8"
            y2="12"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="16"
            y1="12"
            x2="21"
            y2="12"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="3"
            x2="12"
            y2="8"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="16"
            x2="12"
            y2="21"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${extrudeSelectMode ? "active" : ""}`}
        title={
          hasFaceSelected
            ? "Extrude the selected face along its normal"
            : "Extrude — click an enclosed sketch region or flat face"
        }
        onClick={handleExtrudeClick}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <polygon
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="12,3 21,8 21,16 12,21 3,16 3,8"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            strokeLinecap="square"
            x1="3"
            y1="8"
            x2="21"
            y2="8"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x1="3"
            y1="16"
            x2="21"
            y2="16"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x1="12"
            y1="3"
            x2="12"
            y2="21"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Plane — a reference plane to sketch on (from the selected sketch, else pick 3 points)"
        onClick={handlePlane}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <polygon
            points="3,9 14,5 21,11 10,15"
            fill="rgba(68,136,255,0.25)"
            stroke="#4488ff"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <line
            x1="12"
            y1="10"
            x2="12"
            y2="20"
            stroke="#D4A33F"
            strokeWidth="1.5"
            strokeDasharray="2 2"
          />
        </svg>
      </button>
      {/* Sketch→solid sweeps (Revolve / Pipe / Loft) live here in Create. */}
      <SweepSection bare />
    </ToolbarSection>
  );
};

export default ObjectCreateSection;
