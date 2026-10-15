// Profiles saved before they recorded loopShapes (which sketch shapes bound
// them -- closedLoops.js#loopShapesOf) get it at load, so a later edit of the
// sketch re-finds them by shape rather than by outline.  Stamped only where
// the sketch still has exactly one region matching the stored outline: same
// hole count, area within 3 % (tessellation alone differs by about 1 %) and the
// same centroid.  A profile whose sketch has changed since is left as it was
// and keeps matching by geometry.

import { regionsWithShapes } from "./sceneObjects/closedLoops.js";
import { polyArea, polyCentroid } from "./sceneObjects/polygonUtil.js";
import { extrudeWithLivePolygon } from "./csgUtils.js";

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

// Profiles saved before they recorded their exact curves (curves2D) are
// upgraded when the timeline is recalculated in full: each takes its live
// polygon and curves from its sketch, so its body rebuilds from true arcs and
// beziers.  The polygon is replaced WITH the curves because the runs index its
// vertices.  A profile whose sketch no longer has its region is left alone; one
// pinned faceted (curves2D: null, by pinFacetedProfiles) is never offered again.
// Every copy counts -- an extrude's own profile and the frozen sources of the
// ops built on it -- so each is found by shape rather than by `type` (the sweep
// tools' copies carry none).
export function upgradeProfileCurves(history, precision) {
  const sketches = new Map();
  for (const e of history) {
    const inst = e.instruction;
    if (inst?.type === "create" && inst.item?.type === "sketch")
      sketches.set(inst.item.id, inst.item);
  }
  if (sketches.size === 0) return history;
  const sketchItems = [...sketches.values()];
  const none = { outer: [], holes: [] };
  const live = new Map();
  const upgrade = (p) => {
    // Copies of one profile upgrade alike: key on what identifies it.
    const key = profileKey(p) + `|${p.polygon2D.length}`;
    if (!live.has(key)) {
      const probe = { type: "extrude", profile: { ...p, curves2D: none } };
      const got = extrudeWithLivePolygon(probe, sketchItems, precision).profile;
      live.set(key, got.curves2D === none ? null : got);
    }
    const got = live.get(key);
    if (!got) return p;
    return {
      ...p,
      polygon2D: got.polygon2D,
      holes: got.holes,
      curves2D: got.curves2D,
      curvesUpgraded: true,
    };
  };
  return walkProfiles(history, (p) =>
    p.curves2D === undefined && sketches.has(p.sketchId) ? upgrade(p) : p,
  );
}

// After an upgrading recalc, a step that failed only since (`failedIds`) is
// pinned back to its facets: every upgraded profile it was built from -- and
// every other copy of those profiles in the timeline -- gets curves2D null,
// which rebuilds the facets its saved selections were made on.
export function pinFacetedProfiles(history, failedIds) {
  const keys = new Set();
  for (const e of history)
    if (failedIds.has(e.id))
      walkProfiles(e.instruction, (p) => {
        if (p.curvesUpgraded) keys.add(profileKey(p));
        return p;
      });
  if (keys.size === 0) return history;
  return walkProfiles(history, (p) => {
    if (!p.curvesUpgraded || !keys.has(profileKey(p))) return p;
    const { curvesUpgraded, ...rest } = p;
    return { ...rest, curves2D: null };
  });
}

// Which profile this is, the same for each copy of it: its sketch, the shapes
// that bound it and the point it was picked at.
function profileKey(p) {
  const c = p.profileCentroid;
  return `${p.sketchId}|${JSON.stringify(p.loopShapes ?? null)}|${
    c ? `${c.x.toFixed(6)},${c.y.toFixed(6)}` : ""
  }`;
}

// Map `fn` over every sketch profile inside `v`, copying only what changed.
function walkProfiles(v, fn) {
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => {
      const y = walkProfiles(x, fn);
      if (y !== x) changed = true;
      return y;
    });
    return changed ? out : v;
  }
  if (!v || typeof v !== "object") return v;
  let out = v;
  if (v.sketchId != null && Array.isArray(v.polygon2D)) out = fn(v);
  for (const [k, x] of Object.entries(out)) {
    if (SKIP.has(k)) continue;
    const y = walkProfiles(x, fn);
    if (y !== x) {
      if (out === v) out = { ...v };
      out[k] = y;
    }
  }
  return out;
}
