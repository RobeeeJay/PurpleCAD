import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const ObjectCreateSection = () => {
  const addItem = useStore((s) => s.addItem);
  const history = useStore((s) => s.history);
  const setSketchPlacementMode = useStore((s) => s.setSketchPlacementMode);
  const extrudeSelectMode = useStore((s) => s.extrudeSelectMode);
  const setExtrudeSelectMode = useStore((s) => s.setExtrudeSelectMode);
  const selectedSubGeometry = useStore((s) => s.selectedSubGeometry);

  const hasFaceSelected = (selectedSubGeometry?.faces?.length ?? 0) > 0;

  const handleExtrudeClick = () => {
    if (extrudeSelectMode) {
      setExtrudeSelectMode(null);
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
    let maxId = 0;
    history.forEach((entry) => {
      if (
        entry.instruction?.type === "create" &&
        entry.instruction.item.id > maxId
      )
        maxId = entry.instruction.item.id;
    });
    const id = maxId + 1;
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
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <line
            x1="3"
            y1="12"
            x2="21"
            y2="12"
            stroke="currentColor"
            strokeWidth="1"
          />
          <line
            x1="12"
            y1="3"
            x2="12"
            y2="21"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Cube"
        onClick={() => createItem("cube")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M3 5v12h18V5M3 5l9-4 9 4m0 12l-9 4-9-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
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
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <ellipse
            cx="12"
            cy="12"
            rx="3"
            ry="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            opacity="0.5"
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
            cx="12"
            cy="6"
            rx="7"
            ry="2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <ellipse
            cx="12"
            cy="18"
            rx="7"
            ry="2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <line
            x1="5"
            y1="6"
            x2="5"
            y2="18"
            stroke="currentColor"
            strokeWidth="2"
          />
          <line
            x1="19"
            y1="6"
            x2="19"
            y2="18"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Torus"
        onClick={() => createItem("torus")}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <ellipse
            cx="12"
            cy="12"
            rx="9"
            ry="4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <ellipse
            cx="12"
            cy="12"
            rx="4"
            ry="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.6"
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
          <rect
            x="4"
            y="14"
            width="16"
            height="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <polygon
            points="4,14 8,8 20,8 20,14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.7"
          />
          <line
            x1="12"
            y1="8"
            x2="12"
            y2="3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <polyline
            points="9,5 12,2 15,5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default ObjectCreateSection;
