// Icon for a sketch "centre" constraint: a small ring and cross on Shape A's
// centre -- where the constraint holds it -- and, when there is an offset, a
// thin leader back to Shape B's centre so the offset reads as a distance.  Its
// own module because constraintIcons.js is past the size ceiling.

import * as THREE from "three";
import { shapeSetCentre } from "../sketchGeometry.js";

export function addCentreConstraintIcon({
  c,
  shapes,
  toWorld,
  tag,
  group,
  markFixedSize,
  color,
}) {
  const a = shapeSetCentre(shapes, c.shapesA);
  const b = shapeSetCentre(shapes, c.shapesB);
  if (!a || !b) return;
  const indices = [...c.shapesA, ...c.shapesB];
  const material = () =>
    new THREE.LineBasicMaterial({ color, depthTest: false });

  const R = 0.1;
  const pts = [];
  const SEG = 16;
  for (let i = 0; i < SEG; i++) {
    const t0 = (i / SEG) * Math.PI * 2;
    const t1 = ((i + 1) / SEG) * Math.PI * 2;
    pts.push(
      toWorld(a.x + R * Math.cos(t0), a.y + R * Math.sin(t0), 0.005),
      toWorld(a.x + R * Math.cos(t1), a.y + R * Math.sin(t1), 0.005),
    );
  }
  const C = R * 1.6;
  pts.push(
    toWorld(a.x - C, a.y, 0.005),
    toWorld(a.x + C, a.y, 0.005),
    toWorld(a.x, a.y - C, 0.005),
    toWorld(a.x, a.y + C, 0.005),
  );
  const mark = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    material(),
  );
  mark.renderOrder = 1004;
  tag(mark, { x: a.x, y: a.y }, indices, color);
  group.add(mark);
  markFixedSize(mark, toWorld(a.x, a.y, 0.005));

  // The leader spans real geometry, so it scales with the view like a
  // dimension line rather than staying a fixed size.
  if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) {
    const leader = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        toWorld(b.x, b.y, 0.004),
        toWorld(a.x, a.y, 0.004),
      ]),
      material(),
    );
    leader.renderOrder = 1003;
    leader.frustumCulled = false;
    leader.userData.isConstraintObj = true;
    group.add(leader);
  }
}
