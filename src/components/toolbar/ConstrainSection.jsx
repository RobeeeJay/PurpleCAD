import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const ConstrainSection = ({ isSketchMode }) => {
  const selectedId = useStore((s) => s.selectedId);
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

  return (
    <ToolbarSection label="Constrain">
      {isSketchMode ? (
        <>
          <button
            className={`toolbar-btn ${sketchConstraintMode === "coincident" ? "active" : ""}`}
            title="Coincident — make two points share the same position"
            onClick={handleCoincidentConstraint}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <circle
                cx="12"
                cy="12"
                r="5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              <line
                x1="12"
                y1="2"
                x2="12"
                y2="7"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="2 1"
              />
              <line
                x1="12"
                y1="17"
                x2="12"
                y2="22"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="2 1"
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
                x1="4"
                y1="12"
                x2="20"
                y2="12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="3 2"
              />
              <line
                x1="4"
                y1="8"
                x2="4"
                y2="16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <line
                x1="20"
                y1="8"
                x2="20"
                y2="16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <text
                x="12"
                y="10"
                textAnchor="middle"
                fontSize="6"
                fill="currentColor"
                fontFamily="sans-serif"
              >
                d
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
                x1="4"
                y1="12"
                x2="20"
                y2="12"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle cx="4" cy="12" r="2" fill="currentColor" />
              <circle cx="20" cy="12" r="2" fill="currentColor" />
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
                x1="12"
                y1="4"
                x2="12"
                y2="20"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle cx="12" cy="4" r="2" fill="currentColor" />
              <circle cx="12" cy="20" r="2" fill="currentColor" />
            </svg>
          </button>
        </>
      ) : (
        <button className="toolbar-btn" title="Perpendicular">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <line
              x1="4"
              y1="12"
              x2="12"
              y2="12"
              stroke="currentColor"
              strokeWidth="2"
            />
            <line
              x1="12"
              y1="12"
              x2="12"
              y2="20"
              stroke="currentColor"
              strokeWidth="2"
            />
            <rect
              x="10"
              y="10"
              width="4"
              height="4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
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
          <path
            d="M6 3v7a6 6 0 0 0 12 0V3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <line
            x1="5"
            y1="3"
            x2="9"
            y2="3"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <line
            x1="15"
            y1="3"
            x2="19"
            y2="3"
            stroke="currentColor"
            strokeWidth="2.5"
          />
        </svg>
      </button>
    </ToolbarSection>
  );
};

export default ConstrainSection;
