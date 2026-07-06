import * as THREE from "three";
import {
  polyContainsPoint,
  polyCentroid,
  polyAreaCentroid,
  polyArea,
} from "./sceneObjects/polygonUtil.js";
import {
  findClosedLoops,
  groupLoopsWithHoles,
  withWinding,
} from "./sceneObjects/closedLoops.js";

// World-space transform for placing a CSG input.  Extruded items keep
// their original centroid-offset behaviour so the solid sits on the sketch
// plane rather than at the sketch origin.
export function buildBrushTransform(item) {
  const r = item.rotation || { x: 0, y: 0, z: 0 };
  // Full per-axis scale (in the shape's local frame) so a non-uniformly
  // stretched body rebuilds at its visible size for CSG/split/export, not just
  // its scale.x.  Callers apply it before the rotation, matching the mesh's
  // T·R·S order.
  const sc = item.scale || {};
  const s = { x: sc.x ?? 1, y: sc.y ?? 1, z: sc.z ?? 1 };

  if (item.type === "extrude" && item.profile?.polygon2D?.length >= 3) {
    const poly = item.profile.polygon2D;
    // Area centroid (not the vertex mean) so a re-tessellated curve doesn't shift
    // the pivot — must match the centring in occOps.js makeExtrude.  The offset
    // is UNSCALED: the renderer adds it via mesh.position, which mesh.scale does
    // not touch (only the geometry scales, about this centroid).
    const c = polyAreaCentroid(poly);
    const offset = new THREE.Vector3(c.x, c.y, 0);
    offset.applyEuler(new THREE.Euler(r.x || 0, r.y || 0, r.z || 0));
    const base = item.position || { x: 0, y: 0, z: 0 };
    return {
      position: {
        x: base.x + offset.x,
        y: base.y + offset.y,
        z: base.z + offset.z,
      },
      rotation: r,
      scale: s,
    };
  }

  return {
    position: item.position || { x: 0, y: 2, z: 0 },
    rotation: r,
    scale: s,
  };
}

// Compute the chamfered-shape's centroid offset in the source's local
// frame.  New chamfers store this on regenerator.centerOffset at create/
// regen time; for legacy items without it, derive it from item.position
// and the source's brushPos so older saved scenes still work.
export function chamferCenterOffset(regenerator, item) {
  if (regenerator.centerOffset) {
    const { cx, cy, cz } = regenerator.centerOffset;
    return { x: cx, y: cy, z: cz };
  }
  if (!regenerator.source || !item?.position) return null;
  const sourceBrush = buildBrushTransform(regenerator.source).position;
  const dx = item.position.x - sourceBrush.x;
  const dy = item.position.y - sourceBrush.y;
  const dz = item.position.z - sourceBrush.z;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 && Math.abs(dz) < 1e-9) {
    return { x: 0, y: 0, z: 0 };
  }
  const rot = regenerator.source.rotation || { x: 0, y: 0, z: 0 };
  const v = new THREE.Vector3(dx, dy, dz);
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0),
  );
  q.invert();
  v.applyQuaternion(q);
  return { x: v.x, y: v.y, z: v.z };
}

// Re-derive an extrude's profile polygon from its CURRENT sketch geometry (at
// the given curve precision) so OCC shapes used for CSG / chamfer / cut reflect
// live sketch edits — not the polygon captured when the extrude was created.
// `precision` null means preview tessellation (curve segments only).
export function extrudeWithLivePolygon(item, allItems, precision) {
  const profile = item.profile;
  if (!profile || profile.sketchId == null) return item;
  const sketch = allItems.find((i) => i.id === profile.sketchId);
  if (!sketch || !Array.isArray(sketch.shapes) || sketch.shapes.length === 0)
    return item;
  const loops = findClosedLoops(sketch.shapes, 32, precision);
  if (!loops || loops.length === 0) return item;
  const grouped = groupLoopsWithHoles(loops);
  const allEntries = [];
  const collect = (e) => {
    allEntries.push(e);
    e.entries.forEach(collect);
  };
  grouped.forEach(collect);
  if (allEntries.length === 0) return item;
  const pc = profile.profileCentroid;
  const storedArea = polyArea(profile.polygon2D);
  let match = allEntries[0];
  if (pc) {
    const containing = allEntries.filter((g) =>
      polyContainsPoint(g.polygon, pc),
    );
    let pool = containing.length > 0 ? containing : allEntries;
    // A ring's inner loop shows up BOTH as the outer entry's hole AND as a
    // spurious standalone disc entry with the SAME centroid — so the distance
    // test below can't tell them apart and the area tiebreak (against the stale
    // stored area) can pick the disc after a resize, collapsing the ring to a
    // solid inner cylinder.  When the stored profile was a ring (had holes),
    // keep only entries that also have holes, dropping the disc.
    const storedHasHoles = (profile.holes || []).some((h) => h.length >= 3);
    if (storedHasHoles) {
      const withHoles = pool.filter((g) =>
        (g.holes || []).some((h) => h.length >= 3),
      );
      if (withHoles.length > 0) pool = withHoles;
    }
    // Rank by spatial distance from the stored centroid first, area only as a
    // tiebreaker.  Area-alone fallback once mismatched a glyph whose centroid
    // (in its counter) stopped landing inside its own re-simplified loop to a
    // same-area letter elsewhere in the word — collapsing the real one.
    const dist2 = (g) => {
      const c = polyCentroid(g.polygon);
      return (c.x - pc.x) ** 2 + (c.y - pc.y) ** 2;
    };
    match = pool.reduce((best, g) => {
      const dg = dist2(g),
        db = dist2(best);
      if (Math.abs(dg - db) > 1e-9) return dg < db ? g : best;
      const ag = Math.abs(polyArea(g.polygon) - storedArea);
      const ab = Math.abs(polyArea(best.polygon) - storedArea);
      return ag < ab ? g : best;
    });
  }
  if (!match || match.polygon.length < 3) return item;
  return Object.assign({}, item, {
    profile: Object.assign({}, profile, {
      polygon2D: match.polygon,
      holes: match.holes.filter((h) => h.length >= 3),
    }),
  });
}

// Re-derive every extrude profile in an item AND, recursively, in a chamfer/
// bevel source's nested source — so the live sketch geometry feeds the OCC
// shape (the Electron bridge can't import this ESM helper and otherwise builds
// from the stored polygon).  extrudeWithLivePolygon alone only touches the top
// item; a chained op (bevel on a chamfer) keeps a stale nested extrude, which
// the bridge then builds at the old size — shifting the object.
export function withLivePolygons(item, allItems, precision) {
  if (!item) return item;
  if (item.type === "extrude") {
    return extrudeWithLivePolygon(item, allItems, precision);
  }
  if (item.type === "csg" && item.regenerator?.source) {
    return {
      ...item,
      regenerator: {
        ...item.regenerator,
        source: withLivePolygons(item.regenerator.source, allItems, precision),
      },
    };
  }
  return item;
}

// A chamfered SIDE face of an extrude is the wall grown from one polygon edge.
// When the sketch is edited, that edge — and so the face's outward normal and
// centroid — move.  The face selection stored at chamfer time still carries the
// OLD normal/centroid, so OCC can't find the face on the rebuilt shape: the
// chamfer fails and the object keeps its stale pre-edit geometry.  Re-map each
// side-face selection onto the matching edge of the LIVE polygon (paired by
// index, the old edge nearest the stored centroid), so the chamfer tracks the
// sketch.  Top/bottom faces (Z normals) don't move and are left untouched; if
// the polygon's vertex count changed there's no index correspondence, so the
// selection is left as-is (the caller's graceful fallback then applies).
export function remapExtrudeFaceSelections(subGeo, oldSource, newSource) {
  const faces = subGeo?.faces || [];
  if (faces.length === 0) return subGeo;
  if (oldSource?.type !== "extrude" || newSource?.type !== "extrude")
    return subGeo;
  const oldRaw = oldSource.profile?.polygon2D;
  const newRaw = newSource.profile?.polygon2D;
  if (!Array.isArray(oldRaw) || !Array.isArray(newRaw)) return subGeo;
  if (oldRaw.length !== newRaw.length || oldRaw.length < 3) return subGeo;
  // Match the winding makeExtrude uses (CCW) so the computed normals and the
  // edge indices agree with the OCC shape.
  const oldPoly = withWinding(oldRaw, true);
  const newPoly = withWinding(newRaw, true);
  const oldC = polyCentroid(oldPoly);
  const newC = polyCentroid(newPoly);
  const n = oldPoly.length;
  const mid = (poly, i) => {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  // Outward normal of edge i, oriented away from the polygon centroid.
  const outward = (poly, c, i) => {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    let nx = b.y - a.y,
      ny = -(b.x - a.x);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const m = mid(poly, i);
    if ((m.x - c.x) * nx + (m.y - c.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { nx, ny };
  };
  let changed = false;
  const mapped = faces.map((f) => {
    if (Math.abs(f.nz ?? 0) >= 0.9) return f; // top / bottom: unaffected
    // Which old edge did this face come from?  Prefer the stored centroid (in
    // the same local frame), else the stored normal direction.
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      let d;
      if (f.cx != null) {
        const m = mid(oldPoly, i);
        d = Math.hypot(m.x - oldC.x - f.cx, m.y - oldC.y - f.cy);
      } else {
        const on = outward(oldPoly, oldC, i);
        d = Math.hypot(on.nx - f.nx, on.ny - f.ny);
      }
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI < 0) return f;
    const on = outward(newPoly, newC, bestI);
    const m = mid(newPoly, bestI);
    changed = true;
    return {
      ...f,
      nx: on.nx,
      ny: on.ny,
      nz: 0,
      ...(f.cx != null ? { cx: m.x - newC.x, cy: m.y - newC.y } : null),
    };
  });
  return changed ? { ...subGeo, faces: mapped } : subGeo;
}

// The chamfer/bevel source is a snapshot with its extrude depth baked in.
// withLivePolygons re-derives the profile but not the depth, so push the live
// depth down to the (possibly nested) extrude source — otherwise a depth edit
// rebuilds the op at the old height.
export function withLiveDepth(src, depth) {
  if (!src || depth === undefined) return src;
  if (src.type === "extrude")
    return src.depth === depth ? src : { ...src, depth };
  if (src.regenerator?.source) {
    const inner = withLiveDepth(src.regenerator.source, depth);
    return inner === src.regenerator.source
      ? src
      : { ...src, regenerator: { ...src.regenerator, source: inner } };
  }
  return src;
}

const addDelta = (pos, delta) => ({
  x: (pos?.x || 0) + delta.x,
  y: (pos?.y || 0) + delta.y,
  z: (pos?.z || 0) + delta.z,
});

// Retargeting an extrude that anchors a union (buildItemShapeLocal's boolean
// branch re-localises by `regenerator.originalCenter || item.position`, and
// performCsg anchors a fresh union on its FIRST input's brush position) moves
// that anchor by `delta` — the change in the retargeted extrude's
// buildBrushTransform position.  Without updating the frozen anchor, the
// anchor input's own geometry shifts inside the union's local frame, dragging
// any chamfer/fillet `subGeo` selections (and the rendered result) off the
// shape.  Shift `originalCenter` by the same delta so the anchor input's local
// geometry — and selections on it — stay put; with that, the union/chamfer's
// LOCAL geometry is unchanged and the whole result simply translates by
// `delta` in world space, so `position` shifts by `delta` too.  Recurses into
// a chamfer/bevel's nested `source` (chained ops keep their own copy of the
// union snapshot) and propagates the position shift outward through wrappers.
export function shiftUnionAnchorForRetarget(item, extrudeId, delta) {
  if (!item?.regenerator) return item;
  const r = item.regenerator;
  let shifted = r.kind === "boolean" && r.inputIds?.[0] === extrudeId;

  let newSource = r.source;
  if (r.source) {
    newSource = shiftUnionAnchorForRetarget(r.source, extrudeId, delta);
    if (newSource !== r.source) shifted = true;
  }
  if (!shifted) return item;

  return {
    ...item,
    position: addDelta(item.position, delta),
    regenerator: {
      ...r,
      ...(r.kind === "boolean" && r.inputIds?.[0] === extrudeId
        ? {
            originalCenter: addDelta(r.originalCenter || item.position, delta),
          }
        : null),
      ...(newSource !== r.source ? { source: newSource } : null),
      regeneratedAt: "dirty",
    },
  };
}
