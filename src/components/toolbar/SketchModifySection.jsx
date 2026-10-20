import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { offsetSelectedSketchGeometry } from "../../three/sketchModifyActions.js";
import { CircularPatternArt } from "../icons/constraintIconArt.jsx";
import SvgIcon from "../icons/SvgIcon.jsx";

const SketchModifySection = () => {
  const selectedId = useStore((s) => s.selectedId);
  const sketchModifyMode = useStore((s) => s.sketchModifyMode);
  const setSketchModifyMode = useStore((s) => s.setSketchModifyMode);
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

  // "Construction" in the UI; the stored flag stays `dashed`, which is what
  // every saved .pcad already carries.
  const handleToggleConstruction = () => {
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
        <SvgIcon name="chamfer" size={20} />
      </button>
      <button
        className={`toolbar-btn ${sketchModifyMode === "bevel" ? "active" : ""}`}
        title="Bevel — trim two connected lines and join with a smooth arc"
        onClick={() =>
          setSketchModifyMode(sketchModifyMode === "bevel" ? null : "bevel")
        }
      >
        <SvgIcon name="fillet" size={20} />
      </button>
      <button
        className={`toolbar-btn ${activeSketchTool === "trim" ? "active" : ""}`}
        title="Trim — click or drag over a line or a point; a line is removed up to where it crosses another line"
        onClick={handleTrim}
      >
        <SvgIcon name="trim" size={20} />
      </button>
      <button
        className="toolbar-btn"
        title="Toggle Construction — construction lines constrain geometry but don't form closed regions or extrusions"
        disabled={
          sketchMultiSelectedIndices.length === 0 &&
          selectedSketchElement?.type !== "line"
        }
        onClick={handleToggleConstruction}
      >
        <SvgIcon name="dashed-line" size={20} />
      </button>
      <button
        className="toolbar-btn"
        title="Offset — parallel copy of the selected lines, linked by a distance constraint (hold Shift for the other side)"
        disabled={selectedIndices.length === 0}
        onClick={handleOffset}
      >
        <SvgIcon name="offset" size={20} />
      </button>
      <button
        className={`toolbar-btn ${activeSketchTool === "mirror" ? "active" : ""}`}
        title="Mirror — pick a mirror line, then click geometry to reflect across it"
        onClick={handleMirror}
      >
        <SvgIcon name="sketch-mirror" size={20} />
      </button>
      <button
        className={`toolbar-btn ${activeSketchTool === "circularPattern" ? "active" : ""}`}
        title="Circular Pattern — pick a centre point, then click geometry to repeat it around it"
        onClick={handleCircularPattern}
      >
        <CircularPatternArt />
      </button>
      <button
        className={`toolbar-btn ${activeSketchTool === "rectangularPattern" ? "active" : ""}`}
        title="Rectangular Pattern — repeat the selected geometry on an X/Y grid"
        onClick={handleRectangularPattern}
      >
        <SvgIcon name="sketch-pattern-rectangular" size={20} />
      </button>
      <button
        className={`toolbar-btn ${activeSketchTool === "project" ? "active" : ""}`}
        title="Project — click a 3D edge to project it onto the sketch (tracks the source; immovable until released)"
        onClick={handleProject}
      >
        <SvgIcon name="project" size={20} />
      </button>
      <button
        className="toolbar-btn"
        title="Release projection — strip the projection constraint, leaving editable geometry"
        onClick={handleRelease}
        disabled={!hasProjections}
        style={hasProjections ? undefined : { opacity: 0.45 }}
      >
        <SvgIcon name="release-projection" size={20} />
      </button>
    </ToolbarSection>
  );
};

export default SketchModifySection;
