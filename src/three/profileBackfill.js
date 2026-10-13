// Profiles saved before they recorded loopShapes (which sketch shapes bound
// them -- closedLoops.js#loopShapesOf) get it at load, so a later edit of the
// sketch re-finds them by shape rather than by outline.  Stamped only where
// the sketch still has exactly one region matching the stored outline: same
// hole count, area within 3 % (tessellation alone differs by about 1 %) and the
// same centroid.  A profile whose sketch has changed since is left as it was
// and keeps matching by geometry.

import { regionsWithShapes } from "./sceneObjects/closedLoops.js";
import { polyArea, polyCentroid } from "./sceneObjects/polygonUtil.js";

const AREA_TOL = 0.03;
// Keys whose values are point lists or meshes: nothing to stamp inside them.
const SKIP = new Set(["geometryData", "polygon2D", "holes", "shapes"]);

export function backfillLoopShapes(history) {
  // A sketch is edited in place: its create entry holds its current shapes.
  const sketches = new Map();
  for (const e of history) {
    const inst = e.instruction;
    if (inst?.type === "create" && inst.item?.type === "sketch")
      sketches.set(inst.item.id, inst.item.shapes || []);
  }
  if (sketches.size === 0) return history;
  const regions = new Map();
  const regionsOf = (id) => {
    if (!regions.has(id))
      regions.set(id, regionsWithShapes(sketches.get(id), 32, null));
    return regions.get(id);
  };

  const stamp = (p) => {
    if (!sketches.has(p.sketchId) || p.polygon2D.length < 3) return p;
    const area = Math.abs(polyArea(p.polygon2D));
    if (!(area > 0)) return p;
    const c = polyCentroid(p.polygon2D);
    const nHoles = (p.holes || []).filter((h) => h.length >= 3).length;
    const reach = Math.sqrt(area) * 0.05;
    const matches = regionsOf(p.sketchId).filter((g) => {
      if ((g.holes || []).filter((h) => h.length >= 3).length !== nHoles)
        return false;
      const a = Math.abs(polyArea(g.polygon));
      const gc = polyCentroid(g.polygon);
      return (
        Math.abs(a - area) / area < AREA_TOL &&
        Math.hypot(gc.x - c.x, gc.y - c.y) < reach
      );
    });
    if (matches.length !== 1 || !matches[0].loopShapes.outer.length) return p;
    return { ...p, loopShapes: matches[0].loopShapes };
  };

  const walk = (v) => {
    if (Array.isArray(v)) {
      let changed = false;
      const out = v.map((x) => {
        const y = walk(x);
        if (y !== x) changed = true;
        return y;
      });
      return changed ? out : v;
    }
    if (!v || typeof v !== "object") return v;
    let out = v;
    if (
      v.type === "sketchLoop" &&
      v.sketchId != null &&
      Array.isArray(v.polygon2D) &&
      !v.loopShapes
    )
      out = stamp(v);
    for (const [k, x] of Object.entries(out)) {
      if (SKIP.has(k)) continue;
      const y = walk(x);
      if (y !== x) {
        if (out === v) out = { ...v };
        out[k] = y;
      }
    }
    return out;
  };
  return walk(history);
}
