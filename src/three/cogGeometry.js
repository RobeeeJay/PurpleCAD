// The outline of the sketch "cog" primitive: an involute spur gear.
//
// Standard full-depth proportions at a 20 degree pressure angle: module
// m = pitch diameter / teeth, tip radius = pitch radius + m, root radius =
// pitch radius - 1.25 m.  Each flank is an involute of the base circle (pitch
// radius x cos 20 deg); where the root lies inside the base circle -- fewer
// than about 42 teeth -- the flank carries on down to the root as a radial
// line, the usual simplification that ignores undercut.  A root fillet rounds
// the corner between that flank and the root circle.
//
// Backlash is the free play at the pitch circle between two meshing gears of
// this pattern: each tooth is thinned by half of it, so two such gears in mesh
// leave exactly `backlash` between them.
//
// Everything here is in whatever length unit it is given (the shape stores
// scene units), and the contours are RELATIVE to the gear's centre, like a
// text shape's glyph contours are relative to its anchor.

export const COG_PRESSURE_ANGLE = (20 * Math.PI) / 180;
export const COG_MIN_TEETH = 6;

// Fixed sample counts: the outline cached on the shape, and the FLOOR for every
// resolution.  They already hold the outline to about 0.005 mm on a 40 mm gear
// -- finer than the high-resolution setting's 0.01 mm -- so at the default
// settings a cog looks the same either way, and only a finer print precision
// adds points.  Going coarser at preview, as circles do, was tried and
// measured: the coarse outline let a 1 mm bevel through the validity checks
// that refuse it on this outline, and the same 0.2 mm bevel took 14 s once and
// 940 s the next time, against a steady 12 s here.
const FLANK_SAMPLES = 10;
const FILLET_SAMPLES = 6;
const HOLE_SAMPLES = 64;
const MAX_SAMPLES = 256;

// Segments for an arc of radius r spanning `angle` so no chord strays more
// than `tol` from it -- the rule sketch circles and arcs use (arcSegsN).
// Never fewer than the fixed count `fallback` (see above).
function arcCount(r, angle, tol, fallback) {
  if (!(tol > 0) || !(r > 0)) return fallback;
  const half = Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)));
  const n = Math.ceil(Math.abs(angle) / (2 * half));
  return Math.max(fallback, Math.min(MAX_SAMPLES, n));
}

const inv = (a) => Math.tan(a) - a;

// The radii that fix a gear's proportions.
export function cogRadii({ pitchDiameter, teeth }) {
  const rp = pitchDiameter / 2;
  const m = pitchDiameter / teeth;
  return {
    module: m,
    pitch: rp,
    tip: rp + m,
    root: rp - 1.25 * m,
    base: rp * Math.cos(COG_PRESSURE_ANGLE),
  };
}

// Half the angle a tooth spans at radius r, for r on the involute (r >= base).
function halfAngleAt(r, R, halfPitchAngle) {
  const alpha = Math.acos(Math.min(1, R.base / r));
  return halfPitchAngle + inv(COG_PRESSURE_ANGLE) - inv(alpha);
}

// Why these parameters can't make a gear, in words for the dialog -- or null.
export function cogProblem(p) {
  const { pitchDiameter, teeth, backlash, rootFillet, holeDiameter } = p;
  if (!(pitchDiameter > 0)) return "Pitch diameter must be more than 0.";
  if (!Number.isInteger(teeth) || teeth < COG_MIN_TEETH)
    return `A cog needs a whole number of teeth, at least ${COG_MIN_TEETH}.`;
  if (!(backlash >= 0)) return "Backlash can't be negative.";
  if (!(rootFillet >= 0)) return "Root fillet can't be negative.";
  if (!(holeDiameter >= 0)) return "Hole diameter can't be negative.";
  const R = cogRadii(p);
  const halfPitch = (Math.PI * R.module) / 2 - backlash / 2;
  if (!(halfPitch > 0))
    return "Backlash is wider than a tooth at the pitch circle.";
  if (!(halfAngleAt(R.tip, R, halfPitch / (2 * R.pitch)) > 0))
    return "The teeth come to a point before the tip: use more teeth or less backlash.";
  if (holeDiameter >= 2 * R.root)
    return `The hole must be smaller than the root diameter (${fmt(2 * R.root)}).`;
  return null;
}

const fmt = (v) => `${Math.round(v * 100) / 100}`;

const polar = (r, a) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });

// The left flank of the tooth centred on angle 0 (the +angle side), sampled
// from radius r0 up to the tip, plus the local line its lowest part follows:
// a radial line below the base circle, the involute's own tangent otherwise.
function leftFlank(R, halfPitchAngle, tol) {
  const r0 = Math.max(R.base, R.root);
  const t0 = Math.sqrt(Math.max(0, (r0 / R.base) ** 2 - 1));
  const t1 = Math.sqrt((R.tip / R.base) ** 2 - 1);
  // The involute's radius of curvature is base radius x t, largest at the tip,
  // so a step dt there bows base * t1 * dt^2 / 8 off its chord: size dt so
  // that stays within tol everywhere.
  const n =
    tol > 0
      ? Math.max(
          FLANK_SAMPLES,
          Math.min(
            MAX_SAMPLES,
            Math.ceil((t1 - t0) / Math.sqrt((8 * tol) / (R.base * t1))),
          ),
        )
      : FLANK_SAMPLES;
  const involute = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    const r = R.base * Math.sqrt(1 + t * t);
    involute.push({ r, a: halfAngleAt(r, R, halfPitchAngle) });
  }
  const bottom = involute[0];
  let line;
  if (R.root < R.base) {
    // Radial from the base circle down to the root.
    const d = { x: Math.cos(bottom.a), y: Math.sin(bottom.a) };
    line = { p: polar(R.root, bottom.a), d, top: R.base };
  } else {
    // Tangent to the involute where it meets the root circle.
    const p = polar(bottom.r, bottom.a);
    const next = polar(involute[1].r, involute[1].a);
    const len = Math.hypot(next.x - p.x, next.y - p.y) || 1;
    line = {
      p,
      d: { x: (next.x - p.x) / len, y: (next.y - p.y) / len },
      top: bottom.r + 0.4 * (R.tip - bottom.r),
    };
  }
  return { involute, line };
}

// The fillet circle tangent to the flank line (on the gap side) and to the
// root circle (from outside it), or null when rf doesn't fit the gap.
function filletFor(line, R, rf, gapHalfAngle) {
  // The gap lies on the +angle side of the left flank.
  const n = { x: -line.d.y, y: line.d.x };
  const q = { x: line.p.x + rf * n.x, y: line.p.y + rf * n.y };
  const qd = q.x * line.d.x + q.y * line.d.y;
  const disc = qd * qd - (q.x * q.x + q.y * q.y) + (R.root + rf) ** 2;
  if (disc < 0) return null;
  const s = -qd + Math.sqrt(disc);
  const c = { x: q.x + s * line.d.x, y: q.y + s * line.d.y };
  const onFlank = { x: c.x - rf * n.x, y: c.y - rf * n.y };
  const cr = Math.hypot(c.x, c.y);
  const onRoot = { x: (c.x * R.root) / cr, y: (c.y * R.root) / cr };
  if (Math.hypot(onFlank.x, onFlank.y) > line.top) return null;
  if (Math.atan2(onRoot.y, onRoot.x) >= gapHalfAngle) return null;
  return { c, rf, onFlank, onRoot };
}

// The largest fillet up to the requested one that fits; the teeth of a small
// or coarse gear leave less room at the root than a fine one.
function fittingFillet(line, R, requested, gapHalfAngle) {
  if (requested <= 0) return null;
  const exact = filletFor(line, R, requested, gapHalfAngle);
  if (exact) return exact;
  let lo = 0,
    hi = requested,
    best = null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const f = filletFor(line, R, mid, gapHalfAngle);
    if (f) {
      best = f;
      lo = mid;
    } else hi = mid;
  }
  return best;
}

function arcPoints(c, from, to, samples) {
  const r = Math.hypot(from.x - c.x, from.y - c.y);
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  let a1 = Math.atan2(to.y - c.y, to.x - c.x);
  // The short way round: a fillet is always less than a half turn.
  while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
  while (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const a = a0 + ((a1 - a0) * i) / samples;
    pts.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return pts;
}

const mirror = (p) => ({ x: p.x, y: -p.y });
const rotate = (p, a) => ({
  x: p.x * Math.cos(a) - p.y * Math.sin(a),
  y: p.x * Math.sin(a) + p.y * Math.cos(a),
});

// The gear's closed contours relative to its centre: the outline, then the
// centre hole when it has one.  `filletUsed` is the root fillet actually drawn,
// which is smaller than the one asked for when that doesn't fit the gap.
// `tol`, when given, is the largest a chord may stray from the true curve (in
// the same unit as the parameters); without it the fixed counts are used.
export function cogOutline(p, tol = null) {
  const { teeth, backlash, rootFillet, holeDiameter } = p;
  const R = cogRadii(p);
  const halfPitchAngle =
    ((Math.PI * R.module) / 2 - backlash / 2) / (2 * R.pitch);
  const gapHalfAngle = Math.PI / teeth;
  const { involute, line } = leftFlank(R, halfPitchAngle, tol);
  const fillet = fittingFillet(line, R, rootFillet, gapHalfAngle);

  // One tooth and the half-gaps either side, centred on angle 0, walked
  // counter-clockwise: root, up the right flank, over the tip, down the left
  // flank, root.  The right side mirrors the left.
  const flankStart = fillet
    ? Math.hypot(fillet.onFlank.x, fillet.onFlank.y)
    : line.top === R.base
      ? R.root
      : involute[0].r;
  const leftDown = []; // tip to root on the +angle side
  for (let i = involute.length - 1; i >= 0; i--) {
    const { r, a } = involute[i];
    if (r > flankStart + 1e-12) leftDown.push(polar(r, a));
  }
  // Below the base circle the flank is radial: the involute's last point (on
  // the base circle) runs straight down to the fillet or the root, so it needs
  // no point of its own -- a second one there would be a zero-length segment,
  // which OCC's wire builder rejects.
  let rootStart;
  if (fillet) {
    const sweep =
      Math.atan2(fillet.onRoot.y - fillet.c.y, fillet.onRoot.x - fillet.c.x) -
      Math.atan2(fillet.onFlank.y - fillet.c.y, fillet.onFlank.x - fillet.c.x);
    const turn = Math.abs(Math.atan2(Math.sin(sweep), Math.cos(sweep)));
    leftDown.push(
      ...arcPoints(
        fillet.c,
        fillet.onFlank,
        fillet.onRoot,
        arcCount(fillet.rf, turn, tol, FILLET_SAMPLES),
      ),
    );
    rootStart = Math.atan2(fillet.onRoot.y, fillet.onRoot.x);
  } else {
    const bottom =
      line.top === R.base ? line.p : polar(involute[0].r, involute[0].a);
    leftDown.push(bottom);
    rootStart = Math.atan2(bottom.y, bottom.x);
  }
  // The root from the fillet to mid-gap, where the next unit starts.
  const rootHalf = [];
  const rootN = arcCount(R.root, gapHalfAngle - rootStart, tol, 2);
  for (let i = 1; i <= rootN; i++)
    rootHalf.push(
      polar(R.root, rootStart + ((gapHalfAngle - rootStart) * i) / rootN),
    );

  const left = [...leftDown, ...rootHalf];
  const right = left.map(mirror).reverse(); // mid-gap (below) up to the tip
  // Across the tip, along the tip circle, between its two corners.
  const tipHalf = Math.atan2(left[0].y, left[0].x);
  const tipN = arcCount(R.tip, 2 * tipHalf, tol, 2);
  const tipArc = [];
  for (let i = 1; i < tipN; i++)
    tipArc.push(polar(R.tip, -tipHalf + (2 * tipHalf * i) / tipN));
  const unit = [...right, ...tipArc, ...left];

  const outline = [];
  for (let k = 0; k < teeth; k++) {
    const a = (2 * Math.PI * k) / teeth;
    // Each unit ends at mid-gap where the next begins; keep that point once.
    unit.slice(k === 0 ? 0 : 1).forEach((q) => outline.push(rotate(q, a)));
  }
  outline.pop(); // the last unit's end is the first unit's start

  const contours = [outline];
  if (holeDiameter > 0) {
    const rh = holeDiameter / 2;
    const holeN = arcCount(rh, 2 * Math.PI, tol, HOLE_SAMPLES);
    const hole = [];
    for (let i = 0; i < holeN; i++)
      hole.push(polar(rh, (2 * Math.PI * i) / holeN));
    contours.push(hole);
  }
  return { contours, filletUsed: fillet ? fillet.rf : 0, radii: R };
}

// The parameters a cog shape is built from, as it stores them (scene units).
export const COG_PARAMS = [
  "pitchDiameter",
  "holeDiameter",
  "teeth",
  "backlash",
  "rootFillet",
];

// A complete sketch cog shape: its centre, its parameters, and its outline
// cached as contours relative to the centre -- the same shape of data a text
// shape carries, so the loop finder, the extruder and the explode path read it
// the same way.
export function makeCogShape({ x, y, ...params }) {
  const p = Object.fromEntries(COG_PARAMS.map((k) => [k, params[k]]));
  return { type: "cog", x, y, ...p, contours: cogOutline(p).contours };
}

// A cog shape's contours in sketch coordinates: turned by its rotation (a
// rotate tool sets one) and placed at its centre.  With a tolerance the outline
// is rebuilt at that resolution; without, the cached one is used.
export function cogShapeContours(shape, tol = null) {
  const a = shape.rotation || 0;
  const rel =
    tol > 0
      ? cogOutline(shape, tol).contours
      : shape.contours || cogOutline(shape).contours;
  return rel.map((c) =>
    c.map((q) => {
      const r = a ? rotate(q, a) : q;
      return { x: r.x + shape.x, y: r.y + shape.y };
    }),
  );
}
