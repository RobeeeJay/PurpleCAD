// What the sketch shows for an angle dimension: an arc where the two lines meet,
// or would meet, the value in degrees, and the marker that re-opens it.

import * as THREE from "three";
import { resolveConstraintAngle } from "../geometryParams.js";
import { isFormulaValue } from "../../utils/formulas.js";
import {
  ANGLE_LABEL_TEXT,
  CONSTRAINT_ANGLE_COLOR,
  toCssHex,
} from "../theme.js";
import { getShapePoint } from "./sketchShapes.js";
import { besideLabel, ICON_RIGHT } from "./constraintIconSprites.js";

const ARC_RADIUS = 0.45;
const LABEL_RADIUS = ARC_RADIUS + 0.3;
// Nearly parallel lines meet somewhere off in the distance, where an arc would
// mean nothing beside either of them.
const MAX_REACH = 5;

export function addAngleDimensionIcon({
  c,
  shapes,
  toWorld,
  tag,
  addTagged,
  placeIcon,
  markFixedSize,
  group,
  makeDimLabelSprite,
  theme,
  dimColor,
  showDimensions,
  showConstraints,
}) {
  const a = shapes[c.shapeAIdx];
  const b = shapes[c.shapeBIdx];
  if (a?.type !== "line" || b?.type !== "line") return;
  const adx = a.x2 - a.x1;
  const ady = a.y2 - a.y1;
  const bdx = b.x2 - b.x1;
  const bdy = b.y2 - b.y1;
  const midA = { x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 };
  const midB = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
  const reach =
    MAX_REACH * Math.max(Math.hypot(adx, ady), Math.hypot(bdx, bdy));

  const cross = adx * bdy - ady * bdx;
  let meet = null;
  if (Math.abs(cross) > 1e-9) {
    const t = ((b.x1 - a.x1) * bdy - (b.y1 - a.y1) * bdx) / cross;
    const p = { x: a.x1 + adx * t, y: a.y1 + ady * t };
    if (Math.hypot(p.x - midA.x, p.y - midA.y) < reach) meet = p;
  }

  let labelLocal = { x: (midA.x + midB.x) / 2, y: (midA.y + midB.y) / 2 };
  if (meet) {
    // The arc runs from line A's longer side of the meeting point to the side
    // of B that `sense` pairs with it, so it spans the angle the label states.
    const towardsEnd =
      Math.hypot(a.x2 - meet.x, a.y2 - meet.y) >=
      Math.hypot(a.x1 - meet.x, a.y1 - meet.y);
    const flip = towardsEnd ? 1 : -1;
    const from = Math.atan2(ady * flip, adx * flip);
    const sense = c.sense ?? 1;
    let delta = Math.atan2(bdy * flip * sense, bdx * flip * sense) - from;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    if (showConstraints) {
      const pts = [];
      for (let s = 0; s <= 16; s++) {
        const ang = from + delta * (s / 16);
        pts.push(
          toWorld(
            meet.x + Math.cos(ang) * ARC_RADIUS,
            meet.y + Math.sin(ang) * ARC_RADIUS,
            0.005,
          ),
        );
      }
      const arc = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: CONSTRAINT_ANGLE_COLOR,
          depthTest: false,
        }),
      );
      arc.renderOrder = 1004;
      tag(arc, meet, [c.shapeAIdx, c.shapeBIdx], CONSTRAINT_ANGLE_COLOR);
      group.add(arc);
      markFixedSize(arc, toWorld(meet.x, meet.y, 0.005));
    }
    const mid = from + delta / 2;
    labelLocal = {
      x: meet.x + Math.cos(mid) * LABEL_RADIUS,
      y: meet.y + Math.sin(mid) * LABEL_RADIUS,
    };
  }

  let sprite = null;
  if (showDimensions) {
    const deg = resolveConstraintAngle(c);
    sprite = makeDimLabelSprite(`${Number(deg.toFixed(2))}°`, {
      theme,
      isFormula: isFormulaValue(c.angle),
      color: toCssHex(dimColor),
    });
    sprite.position.copy(toWorld(labelLocal.x, labelLocal.y, 0.006));
    sprite.renderOrder = 1009;
    addTagged(sprite);
  }
  if (showConstraints) {
    placeIcon(labelLocal, ICON_RIGHT, [c.shapeAIdx, c.shapeBIdx], dimColor);
    if (sprite) besideLabel(group.children.at(-1), sprite, 1);
  }
}

// The arc and value on a chamfer's corner lock, at the vertex the lines share.
export function addCornerAngleIcon({
  c,
  shapes,
  toWorld,
  tag,
  addTagged,
  markFixedSize,
  group,
  makeDimLabelSprite,
  theme,
  showDimensions,
}) {
  const sA = shapes[c.shapeAIdx],
    sB = shapes[c.shapeBIdx];
  if (!sA || sA.type !== "line" || !sB || sB.type !== "line") return;
  const P = getShapePoint(sA, c.pointA);
  const oA = getShapePoint(sA, c.pointA === "start" ? "end" : "start");
  const oB = getShapePoint(sB, c.pointB === "start" ? "end" : "start");
  if (!P || !oA || !oB) return;
  const aF = Math.atan2(oA.y - P.y, oA.x - P.x);
  let delta = Math.atan2(oB.y - P.y, oB.x - P.x) - aF;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const AR = 0.45;
  const arcPts = [];
  for (let s = 0; s <= 16; s++) {
    const ang = aF + delta * (s / 16);
    arcPts.push(
      toWorld(P.x + Math.cos(ang) * AR, P.y + Math.sin(ang) * AR, 0.005),
    );
  }
  const arc = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(arcPts),
    new THREE.LineBasicMaterial({
      color: CONSTRAINT_ANGLE_COLOR,
      depthTest: false,
    }),
  );
  arc.renderOrder = 1004;
  tag(
    arc,
    { x: P.x, y: P.y },
    [c.shapeAIdx, c.shapeBIdx],
    CONSTRAINT_ANGLE_COLOR,
  );
  group.add(arc);
  markFixedSize(arc, toWorld(P.x, P.y, 0.005));
  if (showDimensions) {
    const deg = typeof c.angle === "number" ? c.angle : parseFloat(c.angle);
    // Same builder as every other dimension label so the font size matches;
    // angle keeps its own colour and carries no formula prefix.
    const sprite = makeDimLabelSprite(`${Math.round(deg)}°`, {
      theme,
      color: ANGLE_LABEL_TEXT,
    });
    const midAng = aF + delta / 2;
    sprite.position.copy(
      toWorld(
        P.x + Math.cos(midAng) * (AR + 0.3),
        P.y + Math.sin(midAng) * (AR + 0.3),
        0.006,
      ),
    );
    sprite.renderOrder = 1009;
    addTagged(sprite);
  }
}
