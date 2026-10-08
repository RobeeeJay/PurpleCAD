// OCC primitive factories — native C++ addon edition.
//
// Shapes are returned as integer IDs into the native shape store.  The
// caller is responsible for calling occ.releaseShape(id) when done.
// See occ_build.cc for the exact OCC constructor calls and default sizes.

import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const occ = _require("../../../native/occ-addon/build/Release/occ_addon.node");

import { polyCentroid } from "../sceneObjects.js";
import { withWinding } from "../sceneObjects/closedLoops.js";
import { resolveItemDepth } from "../geometryParams.js";

export function makeCube() {
  return occ.makeBox(-1, -1, -1, 1, 1, 1);
}

export function makeSphere() {
  return occ.makeSphere(1.5);
}

export function makeCylinder() {
  // origin at (0, -1, 0), axis +Y, radius 1, height 2 — centred at origin.
  return occ.makeCylinder(-1, 1, 2);
}

export function makeTorus() {
  return occ.makeTorus(1.0, 0.4);
}

export function makeExtrude(item) {
  const poly = item.profile?.polygon2D;
  if (!poly || poly.length < 3) return null;
  const holes = item.profile?.holes || [];
  const depth = resolveItemDepth(item);
  const c = polyCentroid(poly);
  const outerFlat = new Float64Array(
    withWinding(poly, true).flatMap((p) => [p.x, p.y]),
  );
  const holesFlat = holes
    .filter((h) => h && h.length >= 3)
    .map(
      (h) => new Float64Array(withWinding(h, false).flatMap((p) => [p.x, p.y])),
    );
  const prismId = occ.makeExtrude(outerFlat, holesFlat, c.x, c.y, depth);
  // startOffset slides the prism base along the extrude normal (local +Z) so
  // the OCC shape matches the rendered mesh (mirrors occOps.buildItemShapeLocal).
  const startOffset = item.startOffset || 0;
  if (prismId != null && startOffset) {
    const shifted = occ.transformShape(prismId, 0, 0, startOffset, 0, 0, 0);
    occ.releaseShape(prismId);
    return shifted;
  }
  return prismId;
}

export function makePrimitiveShape(item) {
  switch (item.type) {
    case "cube":
      return makeCube();
    case "sphere":
      return makeSphere();
    case "cylinder":
      return makeCylinder();
    case "torus":
      return makeTorus();
    case "extrude":
      return makeExtrude(item);
    default:
      return null;
  }
}
