// Markers for the constraints that lock a sketch primitive -- text and a cog --
// and that re-open its dialog on double-click.  Moved out of constraintIcons.js
// with the cog, which would otherwise have taken that file past its ceiling.

import * as THREE from "three";
import { ICON_UP_RIGHT } from "./constraintIconSprites.js";

// A small "T" mark at the text's top-left anchor, drawn in lines.
export function addTextConstraintIcon({
  c,
  shapes,
  toWorld,
  group,
  tag,
  markFixedSize,
  R,
}) {
  const shape = shapes[c.shapeIdx];
  if (!shape || shape.type !== "text") return;
  const ax = shape.x,
    ay = shape.y;
  const tIcon = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      toWorld(ax - R, ay, 0.005),
      toWorld(ax + R, ay, 0.005),
      toWorld(ax, ay, 0.005),
      toWorld(ax, ay - 2 * R, 0.005),
    ]),
    new THREE.LineBasicMaterial({ color: 0x6c3fd4, depthTest: false }),
  );
  tIcon.renderOrder = 1004;
  tag(tIcon, { x: ax, y: ay }, [c.shapeIdx], 0x6c3fd4);
  group.add(tIcon);
  markFixedSize(tIcon, toWorld(ax, ay, 0.005));
}

// The cog tool's own icon, up and to the right of the cog's centre -- the
// centre is a real point (snap target, drag handle), and a marker drawn ON it
// would be hidden behind it: hover and click find the point first.
export function addCogConstraintIcon({ c, shapes, placeIcon }) {
  const shape = shapes[c.shapeIdx];
  if (!shape || shape.type !== "cog") return;
  placeIcon({ x: shape.x, y: shape.y }, ICON_UP_RIGHT, [c.shapeIdx], 0x6c3fd4);
}
