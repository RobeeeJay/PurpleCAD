// Placement controls for a freshly-imported SVG: a live preview the user can
// drag (handled in sketchInteraction) and scale here before confirming.  Commit
// appends the transformed shapes to the sketch; cancel discards them.

import React, { useState, useEffect, useRef } from "react";
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

export default function SvgPlacementOverlay() {
  const svgImport = useStore((s) => s.svgImport);
  const updateSvgImport = useStore((s) => s.updateSvgImport);
  const variables = useStore((s) => s.variables);
  const placing = !!svgImport;

  const [scale, setScale] = useState("1");
  const seededRef = useRef(false);

  useEffect(() => {
    if (placing && !seededRef.current) {
      seededRef.current = true;
      setScale(String(svgImport.scale ?? 1));
    }
    if (!placing) seededRef.current = false;
  }, [placing]); // eslint-disable-line react-hooks/exhaustive-deps

  const scaleVal = evalValue(scale, variables);
  const scaleValid = Number.isFinite(scaleVal) && scaleVal > 0;

  // Push a valid scale to the store and refresh the preview.
  useEffect(() => {
    if (!placing || !scaleValid) return;
    updateSvgImport({ scale: scaleVal });
    useStore.getState()._cameraControls?.updateSvgPreview?.();
  }, [placing, scaleVal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!placing) return;
    const onKey = (e) => {
      if (e.key === "Escape")
        useStore.getState()._cameraControls?.cancelSvgPlacement?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing]);

  if (!placing) return null;

  const cancel = () =>
    useStore.getState()._cameraControls?.cancelSvgPlacement?.();
  const confirm = () => {
    if (scaleValid) useStore.getState()._cameraControls?.commitSvgPlacement?.();
  };

  return (
    <>
      <div className="sketch-placement-hint">
        Drag the SVG to move · set the scale · Confirm · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay">
        <span
          title="Multiplies the imported outline's size on the sketch plane. It scales about the placement point, so the drawing stays where you dragged it."
          style={{ fontSize: 11, color: "#aaa", marginRight: 4 }}
        >
          Scale:
        </span>
        <FormulaInput
          title="Multiplies the imported outline's size on the sketch plane. It scales about the placement point, so the drawing stays where you dragged it."
          variables={variables}
          autoFocus
          value={scale}
          onChange={(e) => setScale(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") confirm();
          }}
          style={{
            width: 56,
            marginRight: 8,
            border: `1px solid ${scaleValid ? "var(--border-color)" : "#e87575"}`,
          }}
        />
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
          disabled={!scaleValid}
          title="Confirm — add the SVG to the sketch"
          style={btn(true, !scaleValid)}
        >
          Confirm
        </button>
      </div>
    </>
  );
}
