// The three sketch transform tools that share a confirm-blocked-while-invalid
// overlay: mirror, circular pattern and rectangular pattern.  They own the
// patternInvalid map between them -- a field reports validity on change and
// on unmount, so Confirm stays disabled while any field is blank or unparsed.

import React from "react";
import { DebouncedNumberField } from "../inputs.jsx";
import { useStore } from "../../store";

export default function SketchPatternOverlays({
  sketchMode,
  activeSketchTool,
  sketchMirrorState,
  sketchCircularPatternState,
  sketchRectangularPatternState,
  selectedId,
  variables,
}) {
  // by field name; a field reports true (valid) on unmount so a closed tool
  // never leaves a stale block.
  const [patternInvalid, setPatternInvalid] = React.useState({});
  const reportPatternValid = React.useCallback(
    (key) => (valid) =>
      setPatternInvalid((prev) => {
        const blocked = !!prev[key];
        if (valid && blocked) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        if (!valid && !blocked) return { ...prev, [key]: true };
        return prev;
      }),
    [],
  );
  const anyPatternInvalid = Object.keys(patternInvalid).length > 0;

  if (!sketchMode) return null;

  return (
    <>
      {sketchMode && activeSketchTool === "mirror" && sketchMirrorState && (
        <>
          {sketchMirrorState.lineIdx == null ? (
            <div className="sketch-placement-hint">
              Click a line to use as the mirror line · Esc to cancel
            </div>
          ) : (
            <>
              <div className="sketch-placement-hint">
                Click geometry to mirror, click again to remove · Esc to cancel
              </div>
              <div className="sketch-distance-input-overlay">
                <span>
                  Mirroring {sketchMirrorState.shapeIndices.length} item
                  {sketchMirrorState.shapeIndices.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={() => useStore.getState().reselectMirrorLine()}
                  title="Reselect — pick a different mirror line"
                  style={{
                    fontSize: 11,
                    padding: "3px 10px",
                    marginLeft: 8,
                    borderRadius: 3,
                    border: "1px solid var(--border-color)",
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  Reselect line
                </button>
                <button
                  type="button"
                  onClick={() => useStore.getState().cancelMirrorTool()}
                  title="Cancel — discard the mirror"
                  style={{
                    fontSize: 11,
                    padding: "3px 10px",
                    marginLeft: 8,
                    borderRadius: 3,
                    border: "1px solid var(--border-color)",
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={sketchMirrorState.shapeIndices.length === 0}
                  onClick={() => useStore.getState().confirmMirror(selectedId)}
                  title="Confirm — create the mirrored geometry"
                  style={{
                    fontSize: 11,
                    padding: "3px 10px",
                    marginLeft: 8,
                    borderRadius: 3,
                    border: "1px solid var(--accent, #4488ff)",
                    background: "var(--accent, #4488ff)",
                    color: "#fff",
                    cursor: "pointer",
                    opacity:
                      sketchMirrorState.shapeIndices.length === 0 ? 0.5 : 1,
                  }}
                >
                  Confirm
                </button>
              </div>
            </>
          )}
        </>
      )}
      {sketchMode &&
        activeSketchTool === "circularPattern" &&
        sketchCircularPatternState && (
          <>
            {sketchCircularPatternState.centerShapeIdx == null ? (
              <div className="sketch-placement-hint">
                Click a point to use as the pattern centre · Esc to cancel
              </div>
            ) : (
              <>
                <div className="sketch-placement-hint">
                  Click geometry to pattern, click again to remove · Esc to
                  cancel
                </div>
                <div className="sketch-distance-input-overlay">
                  <span>
                    Patterning {sketchCircularPatternState.shapeIndices.length}{" "}
                    item
                    {sketchCircularPatternState.shapeIndices.length === 1
                      ? ""
                      : "s"}
                  </span>
                  <label
                    title="How many copies fill a full turn around the picked centre. More instances sit closer together."
                    style={{
                      marginLeft: 8,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    Instances per 360°
                    <DebouncedNumberField
                      min={2}
                      step={1}
                      storeValue={sketchCircularPatternState.count}
                      validate={(v) => Number.isFinite(v) && v >= 2}
                      onValidChange={reportPatternValid("circCount")}
                      commit={(v) =>
                        useStore.getState().setCircularPatternCount(v)
                      }
                      style={{
                        width: 48,
                        fontSize: 11,
                        padding: "2px 4px",
                        borderRadius: 3,
                        background: "var(--bg-tertiary)",
                        color: "var(--text-primary)",
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      useStore.getState().reselectCircularPatternCenter()
                    }
                    title="Reselect — pick a different centre point"
                    style={{
                      fontSize: 11,
                      padding: "3px 10px",
                      marginLeft: 8,
                      borderRadius: 3,
                      border: "1px solid var(--border-color)",
                      background: "var(--bg-tertiary)",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                    }}
                  >
                    Reselect point
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      useStore.getState().cancelCircularPatternTool()
                    }
                    title="Cancel — discard the circular pattern"
                    style={{
                      fontSize: 11,
                      padding: "3px 10px",
                      marginLeft: 8,
                      borderRadius: 3,
                      border: "1px solid var(--border-color)",
                      background: "var(--bg-tertiary)",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  {(() => {
                    const blocked =
                      sketchCircularPatternState.shapeIndices.length === 0 ||
                      anyPatternInvalid;
                    return (
                      <button
                        type="button"
                        disabled={blocked}
                        onClick={() =>
                          useStore.getState().confirmCircularPattern(selectedId)
                        }
                        title="Confirm — create the patterned geometry"
                        style={{
                          fontSize: 11,
                          padding: "3px 10px",
                          marginLeft: 8,
                          borderRadius: 3,
                          border: "1px solid var(--accent, #4488ff)",
                          background: "var(--accent, #4488ff)",
                          color: "#fff",
                          cursor: blocked ? "not-allowed" : "pointer",
                          opacity: blocked ? 0.5 : 1,
                        }}
                      >
                        Confirm
                      </button>
                    );
                  })()}
                </div>
              </>
            )}
          </>
        )}
      {sketchMode &&
        activeSketchTool === "rectangularPattern" &&
        sketchRectangularPatternState && (
          <>
            <div className="sketch-placement-hint">
              Click geometry to pattern, click again to remove · Esc to cancel
            </div>
            <div className="sketch-distance-input-overlay">
              <span>
                Patterning {sketchRectangularPatternState.shapeIndices.length}{" "}
                item
                {sketchRectangularPatternState.shapeIndices.length === 1
                  ? ""
                  : "s"}
              </span>
              <label
                title="Number of copies along the sketch X axis, counting the original. 1 means no repeat in X."
                style={{
                  marginLeft: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Count X
                <DebouncedNumberField
                  min={1}
                  step={1}
                  variables={variables}
                  storeValue={sketchRectangularPatternState.countX}
                  validate={(v) => Number.isFinite(v) && v >= 1}
                  onValidChange={reportPatternValid("rectCountX")}
                  commit={(v, raw) =>
                    useStore.getState().setRectangularPatternCountX(raw ?? v)
                  }
                  style={{
                    width: 44,
                    fontSize: 11,
                    padding: "2px 4px",
                    borderRadius: 3,
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                  }}
                />
              </label>
              <label
                title="Gap between copies along X. Negative repeats to the left; smaller than the shape makes them overlap."
                style={{
                  marginLeft: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Offset X (mm)
                <DebouncedNumberField
                  step="any"
                  variables={variables}
                  storeValue={sketchRectangularPatternState.offsetX}
                  validate={(v) => Number.isFinite(v)}
                  onValidChange={reportPatternValid("rectOffsetX")}
                  commit={(v, raw) =>
                    useStore.getState().setRectangularPatternOffsetX(raw ?? v)
                  }
                  style={{
                    width: 56,
                    fontSize: 11,
                    padding: "2px 4px",
                    borderRadius: 3,
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                  }}
                />
              </label>
              <label
                title="Number of copies along the sketch Y axis, counting the original."
                style={{
                  marginLeft: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Count Y
                <DebouncedNumberField
                  min={1}
                  step={1}
                  variables={variables}
                  storeValue={sketchRectangularPatternState.countY}
                  validate={(v) => Number.isFinite(v) && v >= 1}
                  onValidChange={reportPatternValid("rectCountY")}
                  commit={(v, raw) =>
                    useStore.getState().setRectangularPatternCountY(raw ?? v)
                  }
                  style={{
                    width: 44,
                    fontSize: 11,
                    padding: "2px 4px",
                    borderRadius: 3,
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                  }}
                />
              </label>
              <label
                title="Gap between copies along Y. Negative repeats downwards."
                style={{
                  marginLeft: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                Offset Y (mm)
                <DebouncedNumberField
                  step="any"
                  variables={variables}
                  storeValue={sketchRectangularPatternState.offsetY}
                  validate={(v) => Number.isFinite(v)}
                  onValidChange={reportPatternValid("rectOffsetY")}
                  commit={(v, raw) =>
                    useStore.getState().setRectangularPatternOffsetY(raw ?? v)
                  }
                  style={{
                    width: 56,
                    fontSize: 11,
                    padding: "2px 4px",
                    borderRadius: 3,
                    background: "var(--bg-tertiary)",
                    color: "var(--text-primary)",
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  useStore.getState().cancelRectangularPatternTool()
                }
                title="Cancel — discard the rectangular pattern"
                style={{
                  fontSize: 11,
                  padding: "3px 10px",
                  marginLeft: 8,
                  borderRadius: 3,
                  border: "1px solid var(--border-color)",
                  background: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              {(() => {
                const blocked =
                  sketchRectangularPatternState.shapeIndices.length === 0 ||
                  anyPatternInvalid;
                return (
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() =>
                      useStore.getState().confirmRectangularPattern(selectedId)
                    }
                    title="Confirm — create the patterned geometry"
                    style={{
                      fontSize: 11,
                      padding: "3px 10px",
                      marginLeft: 8,
                      borderRadius: 3,
                      border: "1px solid var(--accent, #4488ff)",
                      background: "var(--accent, #4488ff)",
                      color: "#fff",
                      cursor: blocked ? "not-allowed" : "pointer",
                      opacity: blocked ? 0.5 : 1,
                    }}
                  >
                    Confirm
                  </button>
                );
              })()}
            </div>
          </>
        )}
    </>
  );
}
