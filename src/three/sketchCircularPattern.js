// Circular pattern tool geometry: rotates sketch shapes by repeated steps of
// 360°/count around a chosen centre point. Like mirror, rotation is an exact
// isometry, so it commutes with the affine interpolation `getSketchShapePoints`
// uses for arcs/beziers — every shape type below has an EXACT rotated copy.

import { getShapePoint } from "./sceneObjects/sketchShapes.js";

// Shape types the Circular Pattern tool can copy — same set as MIRRORABLE_TYPES.
export const CIRCULAR_PATTERNABLE_TYPES = [
  "line",
  "circle",
  "arc",
  "ellipse",
  "bezier",
];

// Rotate point P by `angle` radians (CCW) around `center`.
export const rotatePoint = (P, center, angle) => {
  const dx = P.x - center.x,
    dy = P.y - center.y;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
};

// Rotate `shape` by `angle` radians around `center`. Returns null if the
// shape type isn't patternable.
export const rotateShapeGeometry = (shape, center, angle) => {
  const dashed = shape.dashed ? { dashed: true } : null;
  switch (shape.type) {
    case "line": {
      const p1 = rotatePoint({ x: shape.x1, y: shape.y1 }, center, angle);
      const p2 = rotatePoint({ x: shape.x2, y: shape.y2 }, center, angle);
      return {
        type: "line",
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        ...dashed,
      };
    }
    case "circle": {
      const c = rotatePoint({ x: shape.cx, y: shape.cy }, center, angle);
      return { type: "circle", cx: c.x, cy: c.y, r: shape.r, ...dashed };
    }
    case "arc": {
      const c = rotatePoint({ x: shape.cx, y: shape.cy }, center, angle);
      return {
        type: "arc",
        cx: c.x,
        cy: c.y,
        r: shape.r,
        startAngle: shape.startAngle + angle,
        endAngle: shape.endAngle + angle,
        ...dashed,
      };
    }
    case "ellipse": {
      const c = rotatePoint({ x: shape.cx, y: shape.cy }, center, angle);
      return {
        type: "ellipse",
        cx: c.x,
        cy: c.y,
        rx: shape.rx,
        ry: shape.ry,
        rotation: (shape.rotation || 0) + angle,
        ...dashed,
      };
    }
    case "bezier": {
      const p0 = rotatePoint(shape.p0, center, angle);
      const p1 = rotatePoint(shape.p1, center, angle);
      const p2 = rotatePoint(shape.p2, center, angle);
      const p3 = rotatePoint(shape.p3, center, angle);
      return { type: "bezier", p0, p1, p2, p3, ...dashed };
    }
    default:
      return null;
  }
};

// Recompute every circular-pattern copy from its (live) original + centre
// point. Like mirror copies, these aren't solver variables — driven entirely
// by this geometric recompute. Returns the same array ref when unchanged.
export const applyCircularPatternConstraints = (shapes, constraints) => {
  let out = shapes;
  constraints.forEach((c) => {
    if (c.type !== "circularPattern") return;
    const orig = out[c.origIdx];
    const centerShape = out[c.centerShapeIdx];
    const tgt = out[c.shapeIdx];
    if (!orig || !centerShape || !tgt) return;
    const center = getShapePoint(centerShape, c.centerPointKey);
    if (!center) return;
    const angle = (c.index * 2 * Math.PI) / c.count;
    const rotated = rotateShapeGeometry(orig, center, angle);
    if (!rotated) return;
    if (out === shapes) out = shapes.slice();
    out[c.shapeIdx] = {
      ...rotated,
      ...(tgt.dashed ? { dashed: true } : null),
    };
  });
  return out;
};
