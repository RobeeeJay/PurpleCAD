import * as THREE from "three";
import {
  polyCentroid,
  findClosedLoops,
  groupLoopsWithHoles,
  polyContainsPoint,
  polyArea,
} from "./sceneObjects.js";

// World-space transform for placing a CSG input.  Extruded items keep
// their original centroid-offset behaviour so the solid sits on the sketch
// plane rather than at the sketch origin.
export function buildBrushTransform(item) {
  const r = item.rotation || { x: 0, y: 0, z: 0 };
  const s = item.scale ? item.scale.x : 1;

  if (item.type === "extrude" && item.profile?.polygon2D?.length >= 3) {
    const poly = item.profile.polygon2D;
    const c = polyCentroid(poly);
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
    const pool = containing.length > 0 ? containing : allEntries;
    match = pool.reduce((best, g) => {
      const da = Math.abs(polyArea(g.polygon) - storedArea);
      const db = Math.abs(polyArea(best.polygon) - storedArea);
      return da < db ? g : best;
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
