// Marker for a sketch "centre" constraint: the toolbar's Centre icon beside
// Shape A's centre -- where the constraint holds it -- and, when there is an
// offset, a thin leader back to Shape B's centre so the offset reads as a
// distance.

import * as THREE from "three";
import { shapeSetCentre } from "../sketchGeometry.js";
import { ICON_UP_RIGHT } from "./constraintIconSprites.js";

export function addCentreConstraintIcon({
  c,
  shapes,
  toWorld,
  group,
  placeIcon,
  color,
}) {
  const a = shapeSetCentre(shapes, c.shapesA);
  const b = shapeSetCentre(shapes, c.shapesB);
  if (!a || !b) return;
  placeIcon(a, ICON_UP_RIGHT, [...c.shapesA, ...c.shapesB], color);

  // The leader spans real geometry, so it scales with the view like a
  // dimension line rather than staying a fixed size.
  if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) {
    const leader = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        toWorld(b.x, b.y, 0.004),
        toWorld(a.x, a.y, 0.004),
      ]),
      new THREE.LineBasicMaterial({ color, depthTest: false }),
    );
    leader.renderOrder = 1003;
    leader.frustumCulled = false;
    leader.userData.isConstraintObj = true;
    group.add(leader);
  }
}
