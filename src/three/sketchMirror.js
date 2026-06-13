// Mirror tool geometry: reflects sketch shapes across a chosen mirror line.
// Unlike offset (which approximates bezier normals), every shape type here
// has an EXACT reflection — reflection is a linear isometry, so it commutes
// with the affine interpolation `getSketchShapePoints` uses for arcs/beziers.

// Shape types the Mirror tool can copy — same set as OFFSETTABLE_TYPES, since
// both tools operate on the same renderable/solver-tracked shape kinds.
export const MIRRORABLE_TYPES = ["line", "circle", "arc", "ellipse", "bezier"];

// Reflect point P across the infinite line through (x1,y1)-(x2,y2).
export const reflectPoint = (P, line) => {
  const dx = line.x2 - line.x1,
    dy = line.y2 - line.y1;
  const len = Math.hypot(dx, dy) || 1e-9;
  const dnx = dx / len,
    dny = dy / len;
  const vx = P.x - line.x1,
    vy = P.y - line.y1;
  const dot = vx * dnx + vy * dny;
  const rx = 2 * dot * dnx - vx;
  const ry = 2 * dot * dny - vy;
  return { x: line.x1 + rx, y: line.y1 + ry };
};

// Reflect an angle across the mirror line's direction angle L.
const reflectAngle = (theta, L) => 2 * L - theta;

// Reflect `shape` across `lineShape` (a "line" shape). Returns null if either
// shape can't be mirrored.
export const mirrorShapeGeometry = (shape, lineShape) => {
  if (!lineShape || lineShape.type !== "line") return null;
  const dashed = shape.dashed ? { dashed: true } : null;
  const L = Math.atan2(
    lineShape.y2 - lineShape.y1,
    lineShape.x2 - lineShape.x1,
  );
  switch (shape.type) {
    case "line": {
      const p1 = reflectPoint({ x: shape.x1, y: shape.y1 }, lineShape);
      const p2 = reflectPoint({ x: shape.x2, y: shape.y2 }, lineShape);
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
      const c = reflectPoint({ x: shape.cx, y: shape.cy }, lineShape);
      return { type: "circle", cx: c.x, cy: c.y, r: shape.r, ...dashed };
    }
    case "arc": {
      const c = reflectPoint({ x: shape.cx, y: shape.cy }, lineShape);
      return {
        type: "arc",
        cx: c.x,
        cy: c.y,
        r: shape.r,
        startAngle: reflectAngle(shape.startAngle, L),
        endAngle: reflectAngle(shape.endAngle, L),
        ...dashed,
      };
    }
    case "ellipse": {
      const c = reflectPoint({ x: shape.cx, y: shape.cy }, lineShape);
      return {
        type: "ellipse",
        cx: c.x,
        cy: c.y,
        rx: shape.rx,
        ry: shape.ry,
        rotation: reflectAngle(shape.rotation || 0, L),
        ...dashed,
      };
    }
    case "bezier": {
      const p0 = reflectPoint(shape.p0, lineShape);
      const p1 = reflectPoint(shape.p1, lineShape);
      const p2 = reflectPoint(shape.p2, lineShape);
      const p3 = reflectPoint(shape.p3, lineShape);
      return { type: "bezier", p0, p1, p2, p3, ...dashed };
    }
    default:
      return null;
  }
};

// Recompute every mirror copy from its (live) original + mirror line. Mirror
// copies aren't solver variables — like offset's bezier copies, they're
// driven entirely by this geometric recompute. Returns the same array ref
// when unchanged.
export const applyMirrorConstraints = (shapes, constraints) => {
  let out = shapes;
  constraints.forEach((c) => {
    if (c.type !== "mirror") return;
    const orig = out[c.origIdx];
    const line = out[c.lineIdx];
    const tgt = out[c.shapeIdx];
    if (!orig || !line || !tgt) return;
    const mirrored = mirrorShapeGeometry(orig, line);
    if (!mirrored) return;
    if (out === shapes) out = shapes.slice();
    out[c.shapeIdx] = {
      ...mirrored,
      ...(tgt.dashed ? { dashed: true } : null),
    };
  });
  return out;
};
