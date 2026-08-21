// Tessellation via the native C++ addon.
//
// shapeId is a native shape ID (integer).  Returns a THREE.BufferGeometry
// with position + normal attributes and an index buffer, matching the
// interface the WASM version produced.

import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const occ = _require("../../../native/occ-addon/build/Release/occ_addon.node");
import * as THREE from "three";

export function tessellate(shapeId, precision = null) {
  if (!shapeId) return null;
  const result = occ.tessellate(shapeId, precision ?? 0.5);
  if (!result) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
  geo.setIndex(new THREE.BufferAttribute(result.indices, 1));
  geo.computeVertexNormals();
  return geo;
}
