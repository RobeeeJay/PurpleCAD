// Rectangular pattern tool geometry: repeats sketch shapes on a grid spaced
// by fixed X/Y offsets. Translation is an exact isometry, so it commutes with
// the affine interpolation `getSketchShapePoints` uses for arcs/beziers —
// every shape type below has an EXACT translated copy.

// Shape types the Rectangular Pattern tool can copy — same set as
// MIRRORABLE_TYPES / CIRCULAR_PATTERNABLE_TYPES.
export const RECTANGULAR_PATTERNABLE_TYPES = [
  "line",
  "circle",
  "arc",
  "ellipse",
  "bezier",
];

// Translate `shape` by (dx, dy). Returns null if the shape type isn't
// patternable.
export const translateShapeGeometry = (shape, dx, dy) => {
  const dashed = shape.dashed ? { dashed: true } : null;
  switch (shape.type) {
    case "line":
      return {
        type: "line",
        x1: shape.x1 + dx,
        y1: shape.y1 + dy,
        x2: shape.x2 + dx,
        y2: shape.y2 + dy,
        ...dashed,
      };
    case "circle":
      return {
        type: "circle",
        cx: shape.cx + dx,
        cy: shape.cy + dy,
        r: shape.r,
        ...dashed,
      };
    case "arc":
      return {
        type: "arc",
        cx: shape.cx + dx,
        cy: shape.cy + dy,
        r: shape.r,
        startAngle: shape.startAngle,
        endAngle: shape.endAngle,
        ...dashed,
      };
    case "ellipse":
      return {
        type: "ellipse",
        cx: shape.cx + dx,
        cy: shape.cy + dy,
        rx: shape.rx,
        ry: shape.ry,
        rotation: shape.rotation || 0,
        ...dashed,
      };
    case "bezier":
      return {
        type: "bezier",
        p0: { x: shape.p0.x + dx, y: shape.p0.y + dy },
        p1: { x: shape.p1.x + dx, y: shape.p1.y + dy },
        p2: { x: shape.p2.x + dx, y: shape.p2.y + dy },
        p3: { x: shape.p3.x + dx, y: shape.p3.y + dy },
        ...dashed,
      };
    default:
      return null;
  }
};

// Recompute every rectangular-pattern copy from its (live) original. Like
// mirror/circular-pattern copies, these aren't solver variables — driven
// entirely by this geometric recompute. Returns the same array ref when
// unchanged.
export const applyRectangularPatternConstraints = (shapes, constraints) => {
  let out = shapes;
  constraints.forEach((c) => {
    if (c.type !== "rectangularPattern") return;
    const orig = out[c.origIdx];
    const tgt = out[c.shapeIdx];
    if (!orig || !tgt) return;
    const translated = translateShapeGeometry(orig, c.i * c.dx, c.j * c.dy);
    if (!translated) return;
    if (out === shapes) out = shapes.slice();
    out[c.shapeIdx] = {
      ...translated,
      ...(tgt.dashed ? { dashed: true } : null),
    };
  });
  return out;
};
