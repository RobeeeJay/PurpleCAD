import React, { useEffect } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { measure } from "../three/measure.js";
import { getSketchShapePoints } from "../three/sceneObjects/sketchShapes.js";
import { MM_PER_UNIT } from "../three/sceneObjects/dimensions.js";
import "../styles/MeasureOverlay.css";

const IDENTITY_MESH = {
  quaternion: new THREE.Quaternion(),
  position: new THREE.Vector3(),
};

// Total length of the selected sketch shapes (lines/arcs/circles/…), summed in
// sketch units.  Length is rigid-invariant so the local points suffice.
function sketchSelectionResult(sketch, sel, multi) {
  const idxs = new Set(multi || []);
  if (sel?.type === "line" && sel.shapeIdx != null) idxs.add(sel.shapeIdx);
  const shapes = sketch.shapes || [];
  const sel2 = [...idxs].map((i) => shapes[i]).filter(Boolean);
  if (sel2.length === 0) return null;
  let total = 0;
  for (const s of sel2) {
    const pts = getSketchShapePoints(s, IDENTITY_MESH);
    for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
  }
  return { type: "length", value: total, count: sel2.length };
}

const mm = (v) => `${(v * MM_PER_UNIT).toFixed(2)} mm`;

function describe(result) {
  if (!result) return null;
  if (result.type === "distance") return `Distance  ${mm(result.value)}`;
  if (result.type === "faceDims")
    return `Face  ${mm(result.width)} × ${mm(result.height)}`;
  if (result.type === "length")
    return result.count > 1
      ? `Length (${result.count})  ${mm(result.value)}`
      : `Length  ${mm(result.value)}`;
  return null;
}

const MeasureOverlay = () => {
  const measureTool = useStore((s) => s.measureTool);
  const items = useStore((s) => s.items);
  const selectedId = useStore((s) => s.selectedId);
  const selectedSketchElement = useStore((s) => s.selectedSketchElement);
  const multi = useStore((s) => s.sketchMultiSelectedIndices);
  const clearMeasurePicks = useStore((s) => s.clearMeasurePicks);
  const cancelMeasureTool = useStore((s) => s.cancelMeasureTool);

  useEffect(() => {
    if (!measureTool) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") cancelMeasureTool();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [measureTool, cancelMeasureTool]);

  if (!measureTool) return null;

  const sketch = items.find((i) => i.id === selectedId && i.type === "sketch");
  const sketchResult = sketch
    ? sketchSelectionResult(sketch, selectedSketchElement, multi)
    : null;
  const result = sketchResult || measure(measureTool.picks);
  const text = describe(result);

  const nPicks = measureTool.picks.length;
  const hint = sketch
    ? "Select line(s) for length, or two points for distance · Esc to close"
    : nPicks === 0
      ? "Click a vertex, edge or face. Pick two to measure the distance · Esc to close"
      : nPicks === 1 && !text
        ? "Pick another entity to measure the distance · Esc to close"
        : "Click another entity to measure again · Esc to close";

  return (
    <div className="measure-overlay">
      <span className="measure-readout">{text || "Measure"}</span>
      <span className="measure-hint">{hint}</span>
      {!sketch && nPicks > 0 && (
        <button
          type="button"
          className="measure-clear"
          onClick={clearMeasurePicks}
          title="Clear the current picks"
        >
          Clear
        </button>
      )}
      <button
        type="button"
        className="measure-clear"
        onClick={cancelMeasureTool}
        title="Close the measure tool"
      >
        Done
      </button>
    </div>
  );
};

export default MeasureOverlay;
