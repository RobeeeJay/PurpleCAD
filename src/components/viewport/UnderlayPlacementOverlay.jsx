// Placement controls for a sketch reference underlay (a PNG/JPEG traced over):
// drag the image in the viewport to move it (sketchInteraction), set its real
// width / rotation / opacity here, then Confirm to store it on the sketch.
// Re-opened from the same bar for an existing underlay, where Cancel restores
// the previous values and Remove drops the image entirely.

import React from "react";
import { useStore } from "../../store";
import FormulaInput from "../FormulaInput";
import { evalValue } from "../inputs.jsx";

const btn = (accent, disabled) => ({
  fontSize: 11,
  padding: "3px 10px",
  marginLeft: 8,
  borderRadius: 3,
  border: `1px solid ${accent ? "var(--accent, #4488ff)" : "var(--border-color)"}`,
  background: accent ? "var(--accent, #4488ff)" : "var(--bg-tertiary)",
  color: accent ? "#fff" : "var(--text-primary)",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.5 : 1,
});
const LBL = { fontSize: 11, color: "#aaa", margin: "0 4px 0 8px" };

export default function UnderlayPlacementOverlay() {
  const underlayImport = useStore((s) => s.underlayImport);
  const updateUnderlayImport = useStore((s) => s.updateUnderlayImport);
  const clearUnderlayImport = useStore((s) => s.clearUnderlayImport);
  const setSketchUnderlay = useStore((s) => s.setSketchUnderlay);
  const variables = useStore((s) => s.variables);

  if (!underlayImport) return null;

  const widthVal = evalValue(String(underlayImport.widthMm ?? ""), variables);
  const widthValid = Number.isFinite(widthVal) && widthVal > 0;

  const cancel = () => {
    // Re-opening an existing underlay is a live edit of the committed values,
    // so Cancel must put the original back, not leave the preview's.
    if (underlayImport.editing && underlayImport.original)
      setSketchUnderlay(underlayImport.sketchId, underlayImport.original);
    clearUnderlayImport();
  };
  const confirm = () => {
    if (!widthValid) return;
    const { sketchId, dataUrl, name, imageAspect, offsetX, offsetY } =
      underlayImport;
    setSketchUnderlay(sketchId, {
      dataUrl,
      name,
      imageAspect,
      widthMm: widthVal,
      offsetX: offsetX ?? 0,
      offsetY: offsetY ?? 0,
      rotationDeg: Number(underlayImport.rotationDeg) || 0,
      opacity: Number(underlayImport.opacity) ?? 0.5,
    });
    clearUnderlayImport();
  };
  const remove = () => {
    setSketchUnderlay(underlayImport.sketchId, null);
    clearUnderlayImport();
  };

  return (
    <>
      <div className="sketch-placement-hint">
        Drag the image to move · set its real width · Confirm · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay">
        <span style={{ ...LBL, marginLeft: 0 }}>Width (mm):</span>
        <FormulaInput
          variables={variables}
          autoFocus
          value={String(underlayImport.widthMm ?? "")}
          onChange={(e) => updateUnderlayImport({ widthMm: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") confirm();
          }}
          style={{
            width: 64,
            border: `1px solid ${widthValid ? "var(--border-color)" : "#e87575"}`,
          }}
        />
        <span style={LBL}>Rot°:</span>
        <input
          type="number"
          step="15"
          value={underlayImport.rotationDeg ?? 0}
          onChange={(e) =>
            updateUnderlayImport({ rotationDeg: Number(e.target.value) || 0 })
          }
          onKeyDown={(e) => e.stopPropagation()}
          style={{ width: 56 }}
        />
        <span style={LBL}>Opacity:</span>
        <input
          type="range"
          min="0.05"
          max="1"
          step="0.05"
          value={underlayImport.opacity ?? 0.5}
          onChange={(e) =>
            updateUnderlayImport({ opacity: Number(e.target.value) })
          }
          style={{ width: 90 }}
        />
        {underlayImport.editing && (
          <button
            type="button"
            onClick={remove}
            title="Remove the underlay from this sketch"
            style={btn(false)}
          >
            Remove
          </button>
        )}
        <button
          type="button"
          onClick={cancel}
          title="Cancel"
          style={btn(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!widthValid}
          title="Confirm — place the image under this sketch"
          style={btn(true, !widthValid)}
        >
          Confirm
        </button>
      </div>
    </>
  );
}
