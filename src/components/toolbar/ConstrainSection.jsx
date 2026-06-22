import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

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
  const snapEnabled = useStore((s) => s.snapEnabled);
  const toggleSnap = useStore((s) => s.toggleSnap);
  const snapDistanceMm = useStore((s) => s.snapDistanceMm);
  const snapAngleDeg = useStore((s) => s.snapAngleDeg);

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
            <svg viewBox="0 0 24 24" width="20" height="20">
              <circle
                stroke="#c4c2b8"
                fill="none"
                strokeWidth="1.5"
                cx="8"
                cy="12"
                r="5"
              />
              <circle
                stroke="#c4c2b8"
                fill="none"
                strokeWidth="1.5"
                cx="16"
                cy="12"
                r="5"
              />
              <circle fill="#6C3FD4" stroke="#6C3FD4" r="2" cx="12" cy="12" />
              <line
                stroke="#D4A33F"
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="square"
                x1="8"
                y1="12"
                x2="10"
                y2="12"
              />
              <line
                stroke="#D4A33F"
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="square"
                x1="14"
                y1="12"
                x2="16"
                y2="12"
              />
            </svg>
          </button>
          <button
            className={`toolbar-btn ${sketchConstraintMode === "distance" ? "active" : ""}`}
            title="Distance — set a fixed distance between two points"
            onClick={handleDistanceConstraint}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <line
                stroke="#c4c2b8"
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="square"
                x1="4"
                y1="6"
                x2="4"
                y2="19"
              />
              <line
                stroke="#c4c2b8"
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="square"
                x1="20"
                y1="6"
                x2="20"
                y2="19"
              />
              <line
                stroke="#6C3FD4"
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="square"
                x1="4"
                y1="12"
                x2="20"
                y2="12"
              />
              <polygon
                fill="#6C3FD4"
                stroke="#6C3FD4"
                strokeWidth="0.5"
                points="4,12 7,10.5 7,13.5"
              />
              <polygon
                fill="#6C3FD4"
                stroke="#6C3FD4"
                strokeWidth="0.5"
                points="20,12 17,10.5 17,13.5"
              />
              <line
                stroke="#D4A33F"
                fill="none"
                strokeWidth="1"
                strokeDasharray="2 2"
                x1="4"
                y1="6"
                x2="20"
                y2="6"
              />
              <text
                x="10"
                y="20"
                fontSize="7"
                fontFamily="monospace"
                fill="#D4A33F"
                fontWeight="500"
              >
                dim
              </text>
            </svg>
          </button>
          <button
            className="toolbar-btn"
            title="Horizontal — force the selected line to be horizontal"
            disabled={selectedSketchElement?.type !== "line"}
            onClick={() => {
              if (selectedSketchElement?.type === "line") {
                applySketchHVConstraint(
                  selectedId,
                  selectedSketchElement.shapeIdx,
                  "horizontal",
                );
                // The line may have moved; re-anchor the selection highlight.
                useStore
                  .getState()
                  ._cameraControls?.refreshSketchSelectionOverlay?.();
              }
            }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <line
                stroke="#6C3FD4"
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="square"
                x1="3"
                y1="12"
                x2="21"
                y2="12"
              />
              <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="3" cy="12" />
              <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="21" cy="12" />
              <line
                stroke="#D4A33F"
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="square"
                x1="9"
                y1="9"
                x2="9"
                y2="15"
              />
              <line
                stroke="#D4A33F"
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="square"
                x1="15"
                y1="9"
                x2="15"
                y2="15"
              />
            </svg>
          </button>
          <button
            className="toolbar-btn"
            title="Vertical — force the selected line to be vertical"
            disabled={selectedSketchElement?.type !== "line"}
            onClick={() => {
              if (selectedSketchElement?.type === "line") {
                applySketchHVConstraint(
                  selectedId,
                  selectedSketchElement.shapeIdx,
                  "vertical",
                );
                useStore
                  .getState()
                  ._cameraControls?.refreshSketchSelectionOverlay?.();
              }
            }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <line
                stroke="#6C3FD4"
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="square"
                x1="12"
                y1="3"
                x2="12"
                y2="21"
              />
              <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="12" cy="3" />
              <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="12" cy="21" />
              <line
                stroke="#D4A33F"
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="square"
                x1="9"
                y1="9"
                x2="15"
                y2="9"
              />
              <line
                stroke="#D4A33F"
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="square"
                x1="9"
                y1="15"
                x2="15"
                y2="15"
              />
            </svg>
          </button>
        </>
      ) : (
        <button
          className="toolbar-btn"
          title="Drop to ground — moves the selection so its lowest point sits on Y=0"
          disabled={!canDrop}
          onClick={handleDrop}
        >
          <svg viewBox="0 0 24 24" width="20" height="20">
            <line
              stroke="#D4A33F"
              fill="none"
              strokeWidth="1.5"
              strokeLinecap="square"
              x1="2"
              y1="21"
              x2="22"
              y2="21"
            />
            <line
              stroke="#D4A33F"
              fill="none"
              strokeWidth="1"
              x1="4"
              y1="22.5"
              x2="7"
              y2="21"
            />
            <line
              stroke="#D4A33F"
              fill="none"
              strokeWidth="1"
              x1="9"
              y1="22.5"
              x2="12"
              y2="21"
            />
            <line
              stroke="#D4A33F"
              fill="none"
              strokeWidth="1"
              x1="14"
              y1="22.5"
              x2="17"
              y2="21"
            />
            <line
              stroke="#D4A33F"
              fill="none"
              strokeWidth="1"
              x1="19"
              y1="22.5"
              x2="22"
              y2="21"
            />
            <rect
              stroke="#c4c2b8"
              fill="none"
              strokeWidth="1.5"
              strokeLinejoin="miter"
              x="7"
              y="7"
              width="8"
              height="8"
            />
            <polyline
              stroke="#c4c2b8"
              fill="none"
              strokeWidth="1.5"
              strokeLinejoin="miter"
              points="7,7 9.5,4.5 17.5,4.5 17.5,12.5 15,15"
            />
            <line
              stroke="#c4c2b8"
              fill="none"
              strokeWidth="1.5"
              x1="15"
              y1="7"
              x2="15"
              y2="15"
            />
            <line
              stroke="#c4c2b8"
              fill="none"
              strokeWidth="1.5"
              x1="7"
              y1="7"
              x2="15"
              y2="7"
            />
            <line
              stroke="#D4A33F"
              fill="none"
              strokeWidth="1"
              strokeDasharray="1.5 1.5"
              x1="9.5"
              y1="4.5"
              x2="9.5"
              y2="12.5"
            />
            <line
              stroke="#6C3FD4"
              fill="none"
              strokeWidth="1.5"
              strokeLinecap="square"
              x1="11"
              y1="6"
              x2="11"
              y2="19"
            />
            <polygon
              fill="#6C3FD4"
              stroke="#6C3FD4"
              strokeWidth="0.5"
              points="11,21 9,18 13,18"
            />
          </svg>
        </button>
      )}
      <button
        className={`toolbar-btn ${snapEnabled ? "active" : ""}`}
        title={`${snapEnabled ? "Disable" : "Enable"} snap to grid (${snapDistanceMm}mm / ${snapAngleDeg}°) — set values in Settings`}
        onClick={toggleSnap}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="3"
            y1="6"
            x2="21"
            y2="6"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="3"
            y1="12"
            x2="21"
            y2="12"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="3"
            y1="18"
            x2="21"
            y2="18"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="6"
            y1="3"
            x2="6"
            y2="21"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="12"
            y1="3"
            x2="12"
            y2="21"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="18"
            y1="3"
            x2="18"
            y2="21"
          />
          <circle fill="#6C3FD4" stroke="#6C3FD4" r="1.2" cx="6" cy="6" />
          <circle fill="#6C3FD4" stroke="#6C3FD4" r="1.2" cx="12" cy="6" />
          <circle fill="#6C3FD4" stroke="#6C3FD4" r="1.2" cx="18" cy="6" />
          <circle fill="#6C3FD4" stroke="#6C3FD4" r="1.2" cx="6" cy="12" />
          <circle fill="#6C3FD4" stroke="#6C3FD4" r="1.2" cx="18" cy="12" />
          <circle fill="#6C3FD4" stroke="#6C3FD4" r="1.2" cx="6" cy="18" />
          <circle fill="#6C3FD4" stroke="#6C3FD4" r="1.2" cx="12" cy="18" />
          <circle fill="#6C3FD4" stroke="#6C3FD4" r="1.2" cx="18" cy="18" />
          <circle
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            cx="12"
            cy="12"
            r="3"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="8"
            x2="12"
            y2="9"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="15"
            x2="12"
            y2="16"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="8"
            y1="12"
            x2="9"
            y2="12"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="15"
            y1="12"
            x2="16"
            y2="12"
          />
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default ConstrainSection;
