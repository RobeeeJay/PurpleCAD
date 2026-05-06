import * as THREE from "three";
import { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import { polyCentroid } from "./sceneObjects.js";

// Builds the THREE.BufferGeometry for a given item, or returns null if the
// item type does not produce solid geometry (e.g. sketches).
export function buildItemGeometry(item) {
  switch (item.type) {
    case "cube":     return new THREE.BoxGeometry(2, 2, 2);
    case "sphere":   return new THREE.SphereGeometry(1.5, 32, 32);
    case "cylinder": return new THREE.CylinderGeometry(1, 1, 2, 32);
    case "torus":    return new THREE.TorusGeometry(1.0, 0.4, 16, 32);

    case "extrude": {
      const poly = item.profile?.polygon2D;
      if (!poly || poly.length < 3) return null;
      const holes = item.profile.holes || [];
      const depth = item.depth ?? 1.0;
      const c = polyCentroid(poly);
      const shape = new THREE.Shape(poly.map(p => new THREE.Vector2(p.x - c.x, p.y - c.y)));
      holes.forEach(h =>
        shape.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p.x - c.x, p.y - c.y))))
      );
      const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      // Centre along the extrusion axis to match buildSceneObjects behaviour.
      geo.translate(0, 0, -depth / 2);
      return geo;
    }

    case "csg": {
      if (!item.geometryData) return null;
      const { positions, normals, indices } = item.geometryData;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      if (normals) geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
      if (indices) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
      if (!normals) geo.computeVertexNormals();
      return geo;
    }

    default: return null;
  }
}

// Returns the world-space transform {position, rotation, scale} to use when
// placing the CSG Brush for the given item.
//
// For most item types item.position IS the mesh world position and can be used
// directly.  Extruded items are the exception: buildSceneObjects places the
// mesh at item.position + rotated_centroid_offset so that the solid sits on
// the sketch plane rather than floating at the sketch origin.  The CSG brush
// must mirror that offset or the boolean operation will use the wrong location.
export function buildBrushTransform(item) {
  const r = item.rotation || { x: 0, y: 0, z: 0 };
  const s = item.scale ? item.scale.x : 1;

  if (item.type === "extrude" && item.profile?.polygon2D?.length >= 3) {
    const poly = item.profile.polygon2D;
    const depth = item.depth ?? 1.0;
    const c = polyCentroid(poly);
    const offset = new THREE.Vector3(c.x, c.y, depth / 2);
    offset.applyEuler(new THREE.Euler(r.x || 0, r.y || 0, r.z || 0));
    const base = item.position || { x: 0, y: 0, z: 0 };
    return {
      position: { x: base.x + offset.x, y: base.y + offset.y, z: base.z + offset.z },
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

// Runs the CSG operation on the given items.
// Returns { position, geometryData } for the new item, or null if the
// operation cannot be completed (fewer than two items produce valid geometry).
export function performCsg(selectedItems, operation) {
  const evaluator = new Evaluator();
  const sharedMat = new THREE.MeshStandardMaterial();

  const op = operation === "union"        ? ADDITION
           : operation === "difference"   ? SUBTRACTION
           :                               INTERSECTION;

  // Collect brushes — skip items whose type doesn't produce solid geometry.
  const brushes = [];
  for (const item of selectedItems) {
    const geo = buildItemGeometry(item);
    if (!geo) continue;

    if (!geo.getAttribute("uv")) {
      const count = geo.getAttribute("position").count;
      geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }

    const brush = new Brush(geo, sharedMat);
    const { position: p, rotation: r, scale: s } = buildBrushTransform(item);
    brush.position.set(p.x, p.y, p.z);
    brush.scale.setScalar(s);
    brush.rotation.set(r.x || 0, r.y || 0, r.z || 0);
    brush.updateMatrixWorld();
    brushes.push(brush);
  }

  // Require at least two solids — a single-item "operation" is meaningless
  // and the geometry would be in local space (not world space) making the
  // bbox-centre position calculation wrong.
  if (brushes.length < 2) {
    sharedMat.dispose();
    return null;
  }

  let result = brushes[0];
  for (let i = 1; i < brushes.length; i++) {
    result = evaluator.evaluate(result, brushes[i], op);
  }

  const posAttr  = result.geometry.getAttribute("position");
  const normAttr = result.geometry.getAttribute("normal");
  const idxAttr  = result.geometry.index;

  // Centre the result geometry around its bounding-box centre so that
  // item.position is the world-space pivot of the combined solid.
  const bbox = new THREE.Box3().setFromBufferAttribute(posAttr);
  const centre = new THREE.Vector3();
  bbox.getCenter(centre);
  for (let i = 0; i < posAttr.count; i++) {
    posAttr.setXYZ(i, posAttr.getX(i) - centre.x, posAttr.getY(i) - centre.y, posAttr.getZ(i) - centre.z);
  }
  posAttr.needsUpdate = true;

  sharedMat.dispose();

  return {
    position: { x: centre.x, y: centre.y, z: centre.z },
    geometryData: {
      positions: Array.from(posAttr.array),
      normals:   normAttr ? Array.from(normAttr.array) : null,
      indices:   idxAttr  ? Array.from(idxAttr.array)  : null,
    },
  };
}
