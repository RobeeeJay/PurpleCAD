import * as THREE from "three";
import { polyCentroid } from "./sceneObjects.js";
import { makePrimitiveShape } from "./occ/primitives.js";
import { tessellate, tessellateToData } from "./occ/tessellate.js";
import {
  booleanOp,
  chamferShapeBy,
  filletShapeBy,
  transformShape,
} from "./occ/operations.js";
import { isOccReady } from "./occ/init.js";

// Build the THREE.BufferGeometry for an item.  Primitives, CSG results and
// chamfer/fillet results all go through OpenCascade.js; the OCC kernel is
// expected to be initialized (call ensureOcc() at app startup before any
// scene-building code runs).  Sketches return null (they're 2D); extrude
// items are still served by THREE.ExtrudeGeometry while that path is being
// migrated separately.
export function buildItemGeometry(item, options = {}) {
  const precision = options.printPrecision ?? null;

  if (item.type === "sketch") return null;

  if (
    item.type === "cube" ||
    item.type === "sphere" ||
    item.type === "cylinder" ||
    item.type === "torus" ||
    item.type === "extrude"
  ) {
    if (!isOccReady()) {
      throw new Error(
        `buildItemGeometry(${item.type}) requires OpenCascade — await ensureOcc() before rendering.`,
      );
    }
    const shape = makePrimitiveShape(item);
    if (!shape) return null;
    return tessellate(shape, precision);
  }

  if (item.type === "csg") {
    if (!item.geometryData) return null;
    const { positions, normals, indices } = item.geometryData;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(positions), 3),
    );
    if (normals)
      geo.setAttribute(
        "normal",
        new THREE.BufferAttribute(new Float32Array(normals), 3),
      );
    if (indices)
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    if (!normals) geo.computeVertexNormals();
    return geo;
  }

  return null;
}

// World-space transform for placing a CSG input.  Extruded items keep
// their original centroid-offset behaviour so the solid sits on the sketch
// plane rather than at the sketch origin.
export function buildBrushTransform(item) {
  const r = item.rotation || { x: 0, y: 0, z: 0 };
  const s = item.scale ? item.scale.x : 1;

  if (item.type === "extrude" && item.profile?.polygon2D?.length >= 3) {
    const poly = item.profile.polygon2D;
    const c = polyCentroid(poly);
    // Extrude base sits at z=0 in the sketch local frame; no depth-axis
    // shift here, matching the render path in sceneObjects.js.
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

// Build the OCC TopoDS_Shape for an item, transformed to world space.
// Returns null for items that can't be expressed in OCC yet (e.g. extrude,
// sketch).  Used by performCsg and chamfer paths.
// Build the OCC TopoDS_Shape for an item in its LOCAL frame — the same
// frame as its rendered geometryData (so that edge endpoints picked by
// the user, which come from the rendered mesh, will match edges of this
// shape).
//
// For primitives/extrudes: makePrimitiveShape directly.
// For csg items: recursively rebuild via the regenerator (boolean →
//   inputs at their world positions, then translate back by -item.position
//   so the boolean result sits centred in the item's local frame;
//   chamfer/fillet → rebuild source and apply the recorded operation).
export function buildItemShapeLocal(item, allItems = []) {
  if (
    item.type === "cube" ||
    item.type === "sphere" ||
    item.type === "cylinder" ||
    item.type === "torus" ||
    item.type === "extrude"
  ) {
    return makePrimitiveShape(item);
  }
  if (item.type === "csg" && item.regenerator) {
    const r = item.regenerator;
    if (r.kind === "chamfer") {
      const sourceShape = buildItemShapeLocal(r.source, allItems);
      if (!sourceShape) return null;
      const subGeo = r.subGeo || { edges: [], faces: [] };
      // Use the "*By" variants so face selections expand into their
      // boundary edges (matching the live chamfer/fillet flow).  The plain
      // chamferShape/filletShape variants only accept explicit edges and
      // silently drop face-mode chamfers — that's why STL/STEP exports
      // were missing chamfers and fillets on regenerated CSG items.
      const amount = r.amount ?? 0.05;
      if (r.segments === 1) {
        return chamferShapeBy(sourceShape, subGeo, amount, r.angleRad ?? null);
      }
      return filletShapeBy(sourceShape, subGeo, amount);
    }
    if (r.kind === "boolean") {
      const inputs = (r.inputIds || [])
        .map((id) => allItems.find((i) => i.id === id))
        .filter(Boolean)
        .map((inp) => {
          const local = buildItemShapeLocal(inp, allItems);
          if (!local) return null;
          const t = buildBrushTransform(inp);
          return transformShape(local, t.position, t.rotation);
        })
        .filter(Boolean);
      if (inputs.length < 2) return null;
      let world = booleanOp(r.op, inputs);
      if (!world) return null;
      // Translate back into the item's local frame so edge endpoints
      // picked from the rendered mesh match.  item.position is the
      // anchor used when the csg was created (first input's world
      // position — see occOps.js#performCsg) — geometryData was
      // recentred relative to that anchor at creation, so the same
      // -item.position translation here keeps the OCC shape's
      // coordinate frame aligned with the rendered mesh.
      if (item.position) {
        world = transformShape(
          world,
          { x: -item.position.x, y: -item.position.y, z: -item.position.z },
          null,
        );
      }
      return world;
    }
  }
  return null;
}

// Removed sync `performCsg` — every caller now goes through occClient
// (occOps.js#performCsg), which routes the work to the OCC Web Worker.

// Apply a constant-distance chamfer to the edges in `subGeo` on `item`'s
// shape.  Returns { position, geometryData } for the chamfered result, or
// null if the chamfer couldn't be applied (e.g. unknown edges).
//
// `subGeo.edges` is an array of { ax, ay, az, bx, by, bz } endpoint pairs
// in the item's LOCAL space.  Faces in `subGeo.faces` are handled by
// chamfering every edge on the boundary of the matching face plane.
export function chamferItemEdges(item, subGeo, amount = 0.05) {
  if (!isOccReady()) {
    throw new Error(
      "chamferItemEdges requires OpenCascade — await ensureOcc()",
    );
  }
  let shape;
  if (
    item.type === "cube" ||
    item.type === "sphere" ||
    item.type === "cylinder" ||
    item.type === "torus"
  ) {
    shape = makePrimitiveShape(item);
  } else {
    return null;
  }
  if (!shape) return null;
  const edges = Array.isArray(subGeo?.edges) ? [...subGeo.edges] : [];
  // TODO: face → boundary-edge expansion via OCC TopExp_MapShapesAndAncestors
  // (faces in subGeo.faces still rely on the caller pre-expanding for now).
  if (edges.length === 0) return null;
  const chamfered = chamferShape(shape, edges, amount);
  if (!chamfered) return null;
  return { shape: chamfered, ...tessellateToData(chamfered, null) };
}
