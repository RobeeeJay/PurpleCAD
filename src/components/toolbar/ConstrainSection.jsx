import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import CentreConstraintButton from "./CentreConstraintButton";
import { nearestAxis } from "../../three/sketchConstraints.js";
import {
  CoincidentArt,
  MidpointArt,
  DistanceArt,
  HorizontalArt,
  VerticalArt,
  HorizontalVerticalArt,
  ParallelArt,
  ColinearArt,
  TangentArt,
  EqualArt,
} from "../icons/constraintIconArt.jsx";
import SvgIcon from "../icons/SvgIcon.jsx";

// In sketch mode this is the "Constrain" group (coincident / distance / H / V);
// in 3D it's the "Move" group (drop-to-ground, point-to-point).  Snap is shared.
const ConstrainSection = ({ isSketchMode }) => {
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const sketchConstraintMode = useStore((s) => s.sketchConstraintMode);
  const setSketchConstraintMode = useStore((s) => s.setSketchConstraintMode);
  const setSketchConstraintFirstPoint = useStore(
    (s) => s.setSketchConstraintFirstPoint,
  );
  const setSketchDistanceInput = useStore((s) => s.setSketchDistanceInput);
  const selectedSketchElement = useStore((s) => s.selectedSketchElement);
  const applySketchHVConstraint = useStore((s) => s.applySketchHVConstraint);
  const applySketchPairConstraint = useStore(
    (s) => s.applySketchPairConstraint,
  );
  const multiSelectedIndices = useStore((s) => s.sketchMultiSelectedIndices);
  const snapEnabled = useStore((s) => s.snapEnabled);
  const toggleSnap = useStore((s) => s.toggleSnap);
  const pointToPointTool = useStore((s) => s.pointToPointTool);
  const startPointToPointTool = useStore((s) => s.startPointToPointTool);
  const cancelPointToPointTool = useStore((s) => s.cancelPointToPointTool);
  const originToolActive = useStore((s) => s.originToolActive);
  const setOriginToolActive = useStore((s) => s.setOriginToolActive);
  const snapDistanceMm = useStore((s) => s.snapDistanceMm);
  const snapAngleDeg = useStore((s) => s.snapAngleDeg);
  const measureTool = useStore((s) => s.measureTool);
  const startMeasureTool = useStore((s) => s.startMeasureTool);
  const cancelMeasureTool = useStore((s) => s.cancelMeasureTool);

  const handleCoincidentConstraint = () => {
    if (sketchConstraintMode === "coincident") {
      setSketchConstraintMode(null);
      setSketchConstraintFirstPoint(null);
    } else {
      setSketchConstraintMode("coincident");
      setSketchDistanceInput(null);
      if (selectedSketchElement?.type === "point")
        setSketchConstraintFirstPoint({
          shapeIdx: selectedSketchElement.shapeIdx,
          pointKey: selectedSketchElement.pointKey,
        });
    }
  };

  // Midpoint works like Coincident: always enabled.  If a valid point +
  // target pair is already selected it applies immediately; a single
  // selected element seeds the guided mode's first pick; otherwise the mode
  // asks for both picks.
  const handleMidpointConstraint = () => {
    if (sketchConstraintMode === "midpoint") {
      setSketchConstraintMode(null);
      return;
    }
    const sketch = items.find((i) => i.id === selectedId);
    const shapes = sketch?.shapes || [];
    const MIDPOINT_TARGETS = ["line", "arc", "bezier"];
    const kindOf = (idx) =>
      shapes[idx]?.type === "point"
        ? "point"
        : MIDPOINT_TARGETS.includes(shapes[idx]?.type)
          ? "target"
          : null;

    const multi = multiSelectedIndices || [];
    if (multi.length === 2) {
      const kinds = multi.map(kindOf);
      if (kinds.includes("point") && kinds.includes("target")) {
        applySketchPairConstraint(selectedId, multi[0], multi[1], "midpoint");
        useStore.getState()._cameraControls?.refreshSketchSelectionOverlay?.();
        return;
      }
    }
    setSketchConstraintMode("midpoint");
    setSketchDistanceInput(null);
    // Seed the first pick from the current selection.  A selected POINT
    // element may be a keyed point of another shape (line endpoint, circle
    // centre) — carry the key; a selected line/arc/bezier seeds the target.
    const sel = selectedSketchElement;
    let first = null;
    if (sel?.shapeIdx != null) {
      if (sel.type === "point")
        first = {
          kind: "point",
          shapeIdx: sel.shapeIdx,
          pointKey:
            shapes[sel.shapeIdx]?.type === "point"
              ? null
              : (sel.pointKey ?? null),
        };
      else if (kindOf(sel.shapeIdx) === "target")
        first = { kind: "target", shapeIdx: sel.shapeIdx };
    }
    useStore.getState().setSketchMidpointFirst(first);
  };

  const handleDistanceConstraint = () => {
    if (sketchConstraintMode === "distance") {
      setSketchConstraintMode(null);
      setSketchConstraintFirstPoint(null);
      setSketchDistanceInput(null);
    } else {
      setSketchConstraintMode("distance");
      setSketchConstraintFirstPoint(null);
      setSketchDistanceInput(null);
    }
  };

  // Drop-to-ground (3D "Move" group): enabled when a non-sketch body is selected.
  const dropEligible = (selectedIds.length > 0 ? selectedIds : [selectedId])
    .map((id) => items.find((i) => i.id === id))
    .filter((it) => it && it.type !== "sketch");
  const canDrop = dropEligible.length > 0;
  const handleDrop = () => {
    if (!canDrop) return;
    useStore.getState()._cameraControls?.dropSelectedToGround?.();
  };

  return (
    <ToolbarSection label={isSketchMode ? "Constrain" : "Move"}>
      {isSketchMode ? (
        <>
          <button
            className={`toolbar-btn ${sketchConstraintMode === "coincident" ? "active" : ""}`}
            title="Coincident — make two points share the same position"
            onClick={handleCoincidentConstraint}
          >
            <CoincidentArt />
          </button>
          <button
            className={`toolbar-btn ${sketchConstraintMode === "midpoint" ? "active" : ""}`}
            title="Midpoint — pin a point to the middle of a line, arc or curve (click the point, then the target)"
            onClick={handleMidpointConstraint}
          >
            <MidpointArt />
          </button>
          <CentreConstraintButton />
          <button
            className={`toolbar-btn ${sketchConstraintMode === "distance" ? "active" : ""}`}
            title="Distance — set a fixed distance between two points"
            onClick={handleDistanceConstraint}
          >
            <DistanceArt />
          </button>
          {(() => {
            // One button for both: it applies whichever axis the selected
            // line already lies nearer, and shows which.
            const line =
              selectedSketchElement?.type === "line"
                ? items.find((i) => i.id === selectedId)?.shapes?.[
                    selectedSketchElement.shapeIdx
                  ]
                : null;
            const axis = line ? nearestAxis(line) : null;
            return (
              <button
                className="toolbar-btn"
                title={
                  axis === "vertical"
                    ? "Vertical — force the selected line to be vertical (it is nearer upright than level)"
                    : axis === "horizontal"
                      ? "Horizontal — force the selected line to be horizontal (it is nearer level than upright)"
                      : "Horizontal / Vertical — force the selected line level or upright, whichever it is nearer"
                }
                disabled={!line}
                onClick={() => {
                  if (!line) return;
                  applySketchHVConstraint(
                    selectedId,
                    selectedSketchElement.shapeIdx,
                    axis,
                  );
                  // The line may have moved; re-anchor the selection highlight.
                  useStore
                    .getState()
                    ._cameraControls?.refreshSketchSelectionOverlay?.();
                }}
              >
                {axis === "vertical" ? (
                  <VerticalArt />
                ) : axis === "horizontal" ? (
                  <HorizontalArt />
                ) : (
                  <HorizontalVerticalArt />
                )}
              </button>
            );
          })()}
          {(() => {
            const ready = (multiSelectedIndices?.length || 0) === 2;
            const applyPair = (type) => {
              if (!ready) return;
              applySketchPairConstraint(
                selectedId,
                multiSelectedIndices[0],
                multiSelectedIndices[1],
                type,
              );
              useStore
                .getState()
                ._cameraControls?.refreshSketchSelectionOverlay?.();
            };
            return (
              <>
                <button
                  className="toolbar-btn"
                  title="Parallel — make two selected lines parallel (select two lines)"
                  disabled={!ready}
                  onClick={() => applyPair("parallel")}
                >
                  <ParallelArt />
                </button>
                <button
                  className="toolbar-btn"
                  title="Colinear — make two selected lines lie on the same line"
                  disabled={!ready}
                  onClick={() => applyPair("colinear")}
                >
                  <ColinearArt />
                </button>
                <button
                  className="toolbar-btn"
                  title="Tangent — make a line tangent to an arc/circle, or two arcs/circles tangent"
                  disabled={!ready}
                  onClick={() => applyPair("tangent")}
                >
                  <TangentArt />
                </button>
                <button
                  className="toolbar-btn"
                  title="Equal — match two lines' length, or two circles/arcs' radius (select two)"
                  disabled={!ready}
                  onClick={() => applyPair("equal")}
                >
                  <EqualArt />
                </button>
              </>
            );
          })()}
        </>
      ) : (
        <button
          className="toolbar-btn"
          title="Drop to ground — moves the selection so its lowest point sits on Z=0"
          disabled={!canDrop}
          onClick={handleDrop}
        >
          <SvgIcon name="move-to-ground" size={20} />
        </button>
      )}
      {!isSketchMode && (
        <button
          className={`toolbar-btn ${pointToPointTool ? "active" : ""}`}
          title="Point to Point — pick a vertex on one object, then a vertex on another, to align them"
          onClick={() =>
            pointToPointTool
              ? cancelPointToPointTool()
              : startPointToPointTool()
          }
        >
          <SvgIcon name="point-to-point" size={20} />
        </button>
      )}
      {!isSketchMode && (
        <button
          className={`toolbar-btn ${originToolActive ? "active" : ""}`}
          title="Change origin — click an object, then pick its rotation/scale pivot (centre of mass, centre of object, or a vertex)"
          onClick={() => setOriginToolActive(!originToolActive)}
        >
          <SvgIcon name="change-origin" size={20} />
        </button>
      )}
      <button
        className={`toolbar-btn ${measureTool ? "active" : ""}`}
        title="Measure — distance between two picks (vertices/edges/faces/objects), a single face's dimensions, or selected line length"
        onClick={() => (measureTool ? cancelMeasureTool() : startMeasureTool())}
      >
        <SvgIcon name="measure" size={20} />
      </button>
      <button
        className={`toolbar-btn ${snapEnabled ? "active" : ""}`}
        title={`${snapEnabled ? "Disable" : "Enable"} snap to grid (${snapDistanceMm}mm / ${snapAngleDeg}°) — set values in Settings`}
        onClick={toggleSnap}
      >
        <SvgIcon name="snap-to-grid" size={20} />
      </button>
    </ToolbarSection>
  );
};

export default ConstrainSection;
