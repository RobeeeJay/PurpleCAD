// The closed regions of a sketch, and the extrude profile each one becomes --
// built the same way the viewport builds the regions a person clicks to
// extrude (sceneObjects/sketchOverlays.js), so an agent's region 0 is a region
// a person could have picked.

import * as THREE from "three";
import {
  findClosedLoopsWithShapes,
  groupLoopsWithHoles,
  loopShapesOf,
} from "../three/sceneObjects/closedLoops.js";
import { polyCentroid } from "../three/sceneObjects/polygonUtil.js";
import { activePrecision } from "../three/resolution.js";

// The curve density the viewport offers regions at (Viewport.jsx).
const CURVE_SEGMENTS = 32;

// Outer regions only, each carrying its holes: a circle inside a rectangle is
// one region with a hole, which is what extruding a plate with a bore means.
export function sketchRegions(item) {
  const loops = findClosedLoopsWithShapes(
    item.shapes ?? [],
    CURVE_SEGMENTS,
    activePrecision(),
  );
  const shapesOf = new Map(loops.map((l) => [l.polygon, l.shapeIndices]));
  return groupLoopsWithHoles(loops.map((l) => l.polygon))
    .filter((g) => g.polygon.length >= 3)
    .map((g) => ({
      ...g,
      loopShapes: loopShapesOf(g.polygon, g.holes, shapesOf),
    }));
}

export function extrudeProfile(sketch, { polygon, holes, loopShapes }) {
  const euler = new THREE.Euler(
    sketch.rotation.x,
    sketch.rotation.y,
    sketch.rotation.z,
  );
  const normal = new THREE.Vector3(0, 0, 1).applyEuler(euler);
  return {
    type: "sketchLoop",
    sketchId: sketch.id,
    textShapeIdx: null,
    profileCentroid: polyCentroid(polygon),
    polygon2D: polygon,
    holes: holes.filter((h) => h.length >= 3),
    loopShapes,
    position: { ...sketch.position },
    rotation: { x: euler.x, y: euler.y, z: euler.z },
    normalWorld: { x: normal.x, y: normal.y, z: normal.z },
  };
}
