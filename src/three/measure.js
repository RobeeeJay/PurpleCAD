// Pure measurement geometry for the Measure tool — no store/scene deps so it can
// be unit-tested.  Inputs are "entities" in WORLD coordinates:
//   { kind:"point",    p:[x,y,z] }
//   { kind:"segment",  a:[x,y,z], b:[x,y,z] }          (an edge / a sketch line)
//   { kind:"polyline", pts:[[x,y,z]…], closed?:bool }  (a chain / group of lines)
//   { kind:"face",     pts:[[x,y,z]…], normal:[x,y,z] } (sampled face, for dims)
//   { kind:"object",   pts:[[x,y,z]…] }                 (sampled mesh, for nearest)
//
// measure(entities) →
//   1 entity:  segment/polyline → { type:"length", value }
//              face             → { type:"faceDims", width, height }
//   2 entities: → { type:"distance", value }   (nearest point between them)

import * as THREE from "three";

const v3 = (a) => (a && a.isVector3 ? a : new THREE.Vector3(a[0], a[1], a[2]));

function polylineLength(pts, closed) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]);
  if (closed && pts.length > 2) L += pts[pts.length - 1].distanceTo(pts[0]);
  return L;
}

function pointSegDist(p, a, b) {
  const ab = b.clone().sub(a);
  const len2 = ab.lengthSq() || 1;
  const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / len2, 0, 1);
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

// Closest distance between two finite segments (Ericson, Real-Time Collision
// Detection §5.1.9).
function segSegDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1),
    d2 = q2.clone().sub(p2),
    r = p1.clone().sub(p2);
  const a = d1.lengthSq(),
    e = d2.lengthSq(),
    f = d2.dot(r);
  let s, t;
  if (a <= 1e-12 && e <= 1e-12) return p1.distanceTo(p2);
  if (a <= 1e-12) {
    s = 0;
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-12) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2),
        denom = a * e - b * b;
      s =
        denom > 1e-12
          ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1)
          : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s),
    c2 = p2.clone().addScaledVector(d2, t);
  return c1.distanceTo(c2);
}

// Reduce an entity to world-space points + segments for nearest-distance.
function primitivesOf(e) {
  if (e.kind === "point") return { points: [v3(e.p)], segments: [] };
  if (e.kind === "segment")
    return { points: [], segments: [[v3(e.a), v3(e.b)]] };
  if (e.kind === "polyline") {
    const pts = e.pts.map(v3);
    const segs = [];
    for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
    if (e.closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
    return { points: [], segments: segs };
  }
  // face: outline segments AND sampled points so an interior-nearest still scores;
  // object: just its sampled mesh points.
  if (e.kind === "face") {
    const pts = (e.pts || []).map(v3);
    const segs = [];
    for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1], pts[i]]);
    return { points: pts, segments: segs };
  }
  return { points: (e.pts || []).map(v3), segments: [] };
}

function nearestDistance(e1, e2) {
  const A = primitivesOf(e1),
    B = primitivesOf(e2);
  let best = Infinity;
  for (const pa of A.points)
    for (const pb of B.points) best = Math.min(best, pa.distanceTo(pb));
  for (const pa of A.points)
    for (const [a, b] of B.segments)
      best = Math.min(best, pointSegDist(pa, a, b));
  for (const pb of B.points)
    for (const [a, b] of A.segments)
      best = Math.min(best, pointSegDist(pb, a, b));
  for (const [a1, b1] of A.segments)
    for (const [a2, b2] of B.segments)
      best = Math.min(best, segSegDist(a1, b1, a2, b2));
  return best;
}

// Width × height of a planar face: project its points onto the plane and take the
// extent along the two principal (PCA) in-plane axes, so a rectangle reports its
// own side lengths rather than an axis-aligned box.
function faceDimensions(e) {
  const pts = (e.pts || []).map(v3);
  if (pts.length < 3) return { width: 0, height: 0 };
  const n = e.normal
    ? v3(e.normal).clone().normalize()
    : new THREE.Vector3(0, 0, 1);
  const tmp =
    Math.abs(n.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
  const e1 = new THREE.Vector3().crossVectors(n, tmp).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
  const uv = pts.map((p) => [p.dot(e1), p.dot(e2)]);
  const mu = uv.reduce((s, c) => s + c[0], 0) / uv.length;
  const mv = uv.reduce((s, c) => s + c[1], 0) / uv.length;
  let cuu = 0,
    cuv = 0,
    cvv = 0;
  for (const [u, v] of uv) {
    cuu += (u - mu) ** 2;
    cuv += (u - mu) * (v - mv);
    cvv += (v - mv) ** 2;
  }
  // Principal axis angle of the 2×2 covariance.
  const theta = 0.5 * Math.atan2(2 * cuv, cuu - cvv);
  const ca = Math.cos(theta),
    sa = Math.sin(theta);
  let minA = Infinity,
    maxA = -Infinity,
    minB = Infinity,
    maxB = -Infinity;
  for (const [u, v] of uv) {
    const a = u * ca + v * sa,
      b = -u * sa + v * ca;
    minA = Math.min(minA, a);
    maxA = Math.max(maxA, a);
    minB = Math.min(minB, b);
    maxB = Math.max(maxB, b);
  }
  const d1 = maxA - minA,
    d2 = maxB - minB;
  return { width: Math.max(d1, d2), height: Math.min(d1, d2) };
}

// Radius (circle / arc) and enclosed area (closed primitives) of a single sketch
// shape, in sketch units — for the Measure readout alongside its length.  Each
// is null when it doesn't apply (e.g. an arc has a radius but no area).
export function shapeMetrics(shape) {
  if (!shape) return { radius: null, area: null };
  const radius =
    shape.type === "circle" || shape.type === "arc" ? shape.r : null;
  let area = null;
  if (shape.type === "circle") area = Math.PI * shape.r * shape.r;
  else if (shape.type === "ellipse") area = Math.PI * shape.rx * shape.ry;
  else if (shape.type === "rect")
    area = Math.abs((shape.x2 - shape.x1) * (shape.y2 - shape.y1));
  return { radius, area };
}

export function measure(entities) {
  const es = (entities || []).filter(Boolean);
  if (es.length === 0) return null;
  if (es.length >= 2)
    return { type: "distance", value: nearestDistance(es[0], es[1]) };
  const e = es[0];
  if (e.kind === "segment")
    return { type: "length", value: v3(e.a).distanceTo(v3(e.b)) };
  if (e.kind === "polyline")
    return { type: "length", value: polylineLength(e.pts.map(v3), e.closed) };
  if (e.kind === "face") return { type: "faceDims", ...faceDimensions(e) };
  return null;
}
