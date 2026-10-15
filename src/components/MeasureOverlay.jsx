import { useEffect } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import {
  measure,
  shapeMetrics,
  loopArea,
  chainsOf,
  circleOf,
} from "../three/measure.js";
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
  const polys = [];
  for (const s of sel2) {
    const pts = getSketchShapePoints(s, IDENTITY_MESH);
    polys.push(pts);
    for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
  }
  const res = { type: "length", value: total, count: sel2.length };
  // Lines joined end to end are ONE thing: their length, and -- closed -- the
  // area they enclose, and the diameter when they go round a circle.  Only a
  // second, separate line or chain turns the reading into the distance
  // between the two.  A single circle / arc reports its radius (and a circle
  // its diameter); a single closed primitive its area.
  const chains = chainsOf(polys);
  if (sel2.length === 1) {
    const { radius, area } = shapeMetrics(sel2[0]);
    if (radius != null) res.radius = radius;
    if (sel2[0].type === "circle") res.diameter = 2 * sel2[0].r;
    if (area != null) res.area = area;
  }
  if (chains.length === 1) {
    if (sel2.length > 1) {
      const area = loopArea(polys);
      if (area != null) res.area = area;
    }
    if (res.radius == null) {
      const circle = circleOf(chains[0]);
      if (circle) res.diameter = 2 * circle.r;
    }
  } else if (chains.length === 2) {
    const d = measure(
      chains.map((c) => ({
        kind: "polyline",
        pts: c.pts.map(([x, y]) => [x, y, 0]),
        closed: c.closed,
      })),
    );
    if (d) res.distance = d.value;
  }
  return res;
}

const mm = (v) => `${(v * MM_PER_UNIT).toFixed(2)} mm`;
const mm2 = (v) => `${(v * MM_PER_UNIT * MM_PER_UNIT).toFixed(2)} mm²`;

function describe(result) {
  if (!result) return null;
  if (result.type === "distance") return `Distance  ${mm(result.value)}`;
  if (result.type === "faceDims")
    return `Face  ${mm(result.width)} × ${mm(result.height)}`;
  if (result.type === "length") {
    let s =
      result.count > 1
        ? `Length (${result.count})  ${mm(result.value)}`
        : `Length  ${mm(result.value)}`;
    if (result.radius != null) s += `   ·   Radius  ${mm(result.radius)}`;
    if (result.diameter != null) s += `   ·   Diameter  ${mm(result.diameter)}`;
    if (result.area != null) s += `   ·   Area  ${mm2(result.area)}`;
    if (result.distance != null) s += `   ·   Distance  ${mm(result.distance)}`;
    return s;
  }
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

  // Escape clears the current selection first (3D picks, or the sketch
  // line/point selection it's reading); it only exits the tool when there's
  // nothing selected.  Reads fresh store state so it never acts on a stale set.
  useEffect(() => {
    if (!measureTool) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const s = useStore.getState();
      if (!s.measureTool) return;
      const sk = s.items.find(
        (i) => i.id === s.selectedId && i.type === "sketch",
      );
      const hasPicks = s.measureTool.picks.length > 0;
      if (sk) {
        const hasSketchSel =
          (s.sketchMultiSelectedIndices?.length || 0) > 0 ||
          !!s.selectedSketchElement;
        // Point picks first, then the line/shape selection, then exit.
        if (hasPicks) s.clearMeasurePicks();
        else if (hasSketchSel) {
          s.setSelectedSketchElement(null);
          s.setSketchMultiSelectedIndices([]);
          s._cameraControls?.refreshSketchSelectionOverlay?.();
        } else s.cancelMeasureTool();
      } else if (hasPicks) {
        s.clearMeasurePicks();
      } else {
        s.cancelMeasureTool();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [measureTool]);

  // Draw scene markers (spheres at each pick + a line between two) so the user
  // sees what was picked; clear them when the tool closes.
  useEffect(() => {
    const cc = useStore.getState()._cameraControls;
    if (measureTool) cc?.updateMeasureMarkers?.(measureTool.picks);
    else cc?.clearMeasureMarkers?.();
  }, [measureTool]);
  useEffect(
    () => () => useStore.getState()._cameraControls?.clearMeasureMarkers?.(),
    [],
  );

  if (!measureTool) return null;

  const sketch = items.find((i) => i.id === selectedId && i.type === "sketch");
  const sketchResult = sketch
    ? sketchSelectionResult(sketch, selectedSketchElement, multi)
    : null;
  const result = sketchResult || measure(measureTool.picks);
  const text = describe(result);

  const nPicks = measureTool.picks.length;
  const picked = measureTool.picks.map((p) => p.pick || "point").join(" → ");
  const hint = sketch
    ? "Click points to measure between them; select line(s) for length, two lines/a closed loop for distance/area · Esc to close"
    : nPicks === 0
      ? "Click a vertex or face. Pick two to measure the distance · Esc to close"
      : nPicks === 1
        ? "Pick another entity to measure the distance · Esc to close"
        : "Click again to measure from the last pick · Esc to close";

  return (
    <div className="measure-overlay">
      <span className="measure-readout">{text || "Measure"}</span>
      {!sketch && picked && <span className="measure-picked">{picked}</span>}
      <span className="measure-hint">{hint}</span>
      {nPicks > 0 && (
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
