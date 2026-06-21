import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { offsetSelectedSketchGeometry } from "../../three/sketchModifyActions.js";
import { NumberInput } from "../inputs.jsx";

const SketchModifySection = () => {
  const selectedId = useStore((s) => s.selectedId);
  const sketchModifyMode = useStore((s) => s.sketchModifyMode);
  const setSketchModifyMode = useStore((s) => s.setSketchModifyMode);
  const sketchModifyDistMm = useStore((s) => s.sketchModifyDistMm);
  const setSketchModifyDistMm = useStore((s) => s.setSketchModifyDistMm);
  const activeSketchTool = useStore((s) => s.activeSketchTool);
  const startMirrorTool = useStore((s) => s.startMirrorTool);
  const cancelMirrorTool = useStore((s) => s.cancelMirrorTool);
  const startCircularPatternTool = useStore((s) => s.startCircularPatternTool);
  const cancelCircularPatternTool = useStore(
    (s) => s.cancelCircularPatternTool,
  );
  const startRectangularPatternTool = useStore(
    (s) => s.startRectangularPatternTool,
  );
  const cancelRectangularPatternTool = useStore(
    (s) => s.cancelRectangularPatternTool,
  );
  const sketchMultiSelectedIndices = useStore(
    (s) => s.sketchMultiSelectedIndices,
  );
  const toggleSketchShapesDashed = useStore((s) => s.toggleSketchShapesDashed);
  const selectedSketchElement = useStore((s) => s.selectedSketchElement);
  const setActiveSketchTool = useStore((s) => s.setActiveSketchTool);
  const releaseProjection = useStore((s) => s.releaseProjection);
  const startProjectTool = useStore((s) => s.startProjectTool);
  const cancelProjectTool = useStore((s) => s.cancelProjectTool);
  const items = useStore((s) => s.items);

  const activeSketch = items.find((i) => i.id === selectedId);
  const hasProjections = (activeSketch?.shapes || []).some((s) => s.projection);

  // Project: stage edges from hovered 3D objects (with a preview), then confirm
  // via the dialog to drop them onto the sketch plane as projection-linked
  // geometry (immovable until released).
  const handleProject = () => {
    const turningOff = activeSketchTool === "project";
    setActiveSketchTool(turningOff ? null : "project");
    if (turningOff) {
      const cc = useStore.getState()._cameraControls;
      cc?.clearProjectHover?.();
      cc?.clearProjectionPreview?.();
      cancelProjectTool();
    } else {
      startProjectTool();
    }
  };

  // Release: strip the projection constraint from the selected projected shape's
  // group (else every projection), leaving editable sketch geometry behind.
  const handleRelease = () => {
    const idx = selectedSketchElement?.shapeIdx;
    const key =
      idx != null ? activeSketch?.shapes?.[idx]?.projection?.key : null;
    releaseProjection(selectedId, key ?? null);
  };

  const selectedIndices =
    sketchMultiSelectedIndices.length > 0
      ? sketchMultiSelectedIndices
      : selectedSketchElement?.type === "line"
        ? [selectedSketchElement.shapeIdx]
        : [];

  const handleToggleDashed = () => {
    if (selectedIndices.length > 0)
      toggleSketchShapesDashed(selectedId, selectedIndices);
  };

  // Offset creates a parallel copy linked to each source line; hold Shift to
  // offset to the other (negative) side.
  const handleOffset = (e) => {
    offsetSelectedSketchGeometry(selectedId, selectedIndices, e.shiftKey);
  };

  // Mirror: pick a mirror line, then click geometry to preview/toggle its
  // reflection; Confirm creates copies linked by a mirror constraint.
  const handleMirror = () => {
    if (activeSketchTool === "mirror") cancelMirrorTool();
    else startMirrorTool();
  };

  // Circular Pattern: pick a centre point, then click geometry to
  // preview/toggle rotated repeats; Confirm creates copies linked by
  // circularPattern constraints.
  const handleCircularPattern = () => {
    if (activeSketchTool === "circularPattern") cancelCircularPatternTool();
    else startCircularPatternTool();
  };

  // Rectangular Pattern: click geometry to preview/toggle repeats spread on
  // an X/Y grid; Confirm creates copies linked by rectangularPattern
  // constraints.
  const handleRectangularPattern = () => {
    if (activeSketchTool === "rectangularPattern")
      cancelRectangularPatternTool();
    else startRectangularPatternTool();
  };

  // Trim: click or drag over a line to remove the part up to its nearest
  // crossing with another line/point.
  const handleTrim = () => {
    const turningOn = activeSketchTool !== "trim";
    setSketchModifyMode(null);
    setActiveSketchTool(turningOn ? "trim" : null);
  };

  return (
    <ToolbarSection label="Modify">
      <button
        className={`toolbar-btn ${sketchModifyMode === "chamfer" ? "active" : ""}`}
        title="Chamfer — trim two connected lines and join with a straight edge"
        onClick={() =>
          setSketchModifyMode(sketchModifyMode === "chamfer" ? null : "chamfer")
        }
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="4"
            y1="20"
            x2="4"
            y2="8"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="4"
            y1="8"
            x2="16"
            y2="8"
          />
          <polyline
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="4,20 4,13 9,8 16,8"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="4" cy="13" />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="9" cy="8" />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="4"
            y1="8"
            x2="4"
            y2="13"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="4"
            y1="8"
            x2="9"
            y2="8"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${sketchModifyMode === "bevel" ? "active" : ""}`}
        title="Bevel — trim two connected lines and join with a smooth arc"
        onClick={() =>
          setSketchModifyMode(sketchModifyMode === "bevel" ? null : "bevel")
        }
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="4"
            y1="20"
            x2="4"
            y2="8"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="4"
            y1="8"
            x2="16"
            y2="8"
          />
          <path
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            strokeLinecap="square"
            d="M4 20 L4 14 Q4 8 10 8 L16 8"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="4" cy="14" />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="10" cy="8" />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="4"
            y1="8"
            x2="4"
            y2="14"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="4"
            y1="8"
            x2="10"
            y2="8"
          />
        </svg>
      </button>
      {(sketchModifyMode === "chamfer" || sketchModifyMode === "bevel") && (
        <label
          title={
            sketchModifyMode === "chamfer"
              ? "Chamfer setback (mm) along each edge"
              : "Bevel arc radius (mm)"
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            color: "var(--text-secondary)",
            padding: "0 4px",
          }}
        >
          {sketchModifyMode === "chamfer" ? "Setback" : "Radius"}
          <NumberInput
            min="0"
            step="0.5"
            value={sketchModifyDistMm}
            onCommit={(v) => {
              if (Number.isFinite(v) && v > 0) setSketchModifyDistMm(v);
            }}
            style={{ width: 46 }}
          />
          mm
        </label>
      )}
      <button
        className={`toolbar-btn ${activeSketchTool === "trim" ? "active" : ""}`}
        title="Trim — click or drag over a line to remove it up to where it crosses another line or point"
        onClick={handleTrim}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          {/* scissors: two blades crossing at a pivot, cutting a dashed line */}
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 2"
            x1="3"
            y1="12"
            x2="21"
            y2="12"
          />
          <circle
            cx="7"
            cy="8"
            r="2.4"
            fill="none"
            stroke="#6C3FD4"
            strokeWidth="1.5"
          />
          <circle
            cx="7"
            cy="16"
            r="2.4"
            fill="none"
            stroke="#6C3FD4"
            strokeWidth="1.5"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            x1="9"
            y1="9.3"
            x2="20"
            y2="15"
          />
          <line
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            x1="9"
            y1="14.7"
            x2="20"
            y2="9"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Toggle Dashed — dashed lines constrain geometry but don't form closed regions or extrusions"
        disabled={
          sketchMultiSelectedIndices.length === 0 &&
          selectedSketchElement?.type !== "line"
        }
        onClick={handleToggleDashed}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeDasharray="3 2.5"
            x1="3"
            y1="21"
            x2="21"
            y2="3"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="3" cy="21" />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="21" cy="3" />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Offset — parallel copy of the selected lines, linked by a distance constraint (hold Shift for the other side)"
        disabled={selectedIndices.length === 0}
        onClick={handleOffset}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            d="M5 17 L5 8 L14 8"
          />
          <path
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            d="M8 20 L8 11 L17 11"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="5"
            y1="8"
            x2="8"
            y2="11"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="5"
            y1="17"
            x2="8"
            y2="20"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="14"
            y1="8"
            x2="17"
            y2="11"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${activeSketchTool === "mirror" ? "active" : ""}`}
        title="Mirror — pick a mirror line, then click geometry to reflect across it"
        onClick={handleMirror}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 2"
            x1="12"
            y1="2"
            x2="12"
            y2="22"
          />
          <path
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            d="M11 4 L11 10 L4 17"
          />
          <path
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            d="M13 4 L13 10 L20 17"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${activeSketchTool === "circularPattern" ? "active" : ""}`}
        title="Circular Pattern — pick a centre point, then click geometry to repeat it around it"
        onClick={handleCircularPattern}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle
            cx="12"
            cy="12"
            r="8"
            stroke="#D4A33F"
            strokeDasharray="2 2"
            fill="none"
            strokeWidth="1.5"
          />
          <circle cx="12" cy="12" r="1" fill="#D4A33F" />
          <rect x="10.5" y="2.5" width="3" height="3" fill="#6C3FD4" />
          <rect x="17.5" y="9.5" width="3" height="3" fill="#c4c2b8" />
          <rect x="3.5" y="9.5" width="3" height="3" fill="#c4c2b8" />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${activeSketchTool === "rectangularPattern" ? "active" : ""}`}
        title="Rectangular Pattern — repeat the selected geometry on an X/Y grid"
        onClick={handleRectangularPattern}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect x="3" y="3" width="6" height="6" fill="#6C3FD4" stroke="none" />
          <rect
            x="15"
            y="3"
            width="6"
            height="6"
            fill="#c4c2b8"
            stroke="none"
          />
          <rect
            x="3"
            y="15"
            width="6"
            height="6"
            fill="#c4c2b8"
            stroke="none"
          />
          <rect
            x="15"
            y="15"
            width="6"
            height="6"
            fill="#c4c2b8"
            stroke="none"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="9"
            y1="6"
            x2="15"
            y2="6"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="6"
            y1="9"
            x2="6"
            y2="15"
          />
        </svg>
      </button>
      <button
        className={`toolbar-btn ${activeSketchTool === "project" ? "active" : ""}`}
        title="Project — click a 3D edge to project it onto the sketch (tracks the source; immovable until released)"
        onClick={handleProject}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          {/* 3D edge above */}
          <line
            stroke="#c4c2b8"
            strokeWidth="1.5"
            strokeLinecap="round"
            x1="5"
            y1="5"
            x2="17"
            y2="7"
          />
          {/* projection rays dropping down */}
          <line
            stroke="#D4A33F"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="5"
            y1="5"
            x2="5"
            y2="17"
          />
          <line
            stroke="#D4A33F"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="17"
            y1="7"
            x2="17"
            y2="19"
          />
          {/* projected line on the sketch plane */}
          <line
            stroke="#6C3FD4"
            strokeWidth="2"
            strokeLinecap="round"
            x1="5"
            y1="17"
            x2="17"
            y2="19"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Release projection — strip the projection constraint, leaving editable geometry"
        onClick={handleRelease}
        disabled={!hasProjections}
        style={hasProjections ? undefined : { opacity: 0.45 }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          {/* an open padlock — unlock the projection */}
          <rect
            x="6"
            y="11"
            width="12"
            height="9"
            rx="1.5"
            fill="none"
            stroke="#c4c2b8"
            strokeWidth="1.5"
          />
          <path
            d="M9 11 V8 a3 3 0 0 1 6 0"
            fill="none"
            stroke="#D4A33F"
            strokeWidth="1.5"
          />
          <circle cx="12" cy="15" r="1.5" fill="#6C3FD4" />
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default SketchModifySection;
