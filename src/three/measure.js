// Pure measurement geometry for the Measure tool — no store/scene deps so it can
// be unit-tested.  Inputs are "entities" in WORLD coordinates:
//   { kind:"point",    p:[x,y,z] }
//   { kind:"segment",  a:[x,y,z], b:[x,y,z] }          (an edge / a sketch line)
//   { kind:"polyline", pts:[[x,y,z]…], closed?:bool }  (a chain / group of lines)
//   { kind:"face",     pts:[[x,y,z]…], normal:[x,y,z] } (sampled face, for dims)
//   { kind:"object",   pts:[[x,y,z]…] }                 (sampled mesh)
//
// measure(entities) →
//   1 entity:  segment/polyline → { type:"length", value }
//              face             → { type:"faceDims", width, height }
//   2 entities: → { type:"distance", value }   (centre to centre — see anchorOf)

import * as THREE from "three";

const v3 = (a) => (a && a.isVector3 ? a : new THREE.Vector3(a[0], a[1], a[2]));

function polylineLength(pts, closed) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]);
  if (closed && pts.length > 2) L += pts[pts.length - 1].distanceTo(pts[0]);
  return L;
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

// Area enclosed by a set of sketch polylines (each an ordered list of [x,y] or
// {x,y}/Vector3 points) IF they chain end-to-end into a single closed loop — for
// the Measure readout when a closed region is drawn from several separate lines /
// arcs.  Returns null when the pieces don't all connect into one closed loop.
export function loopArea(polylines, tol) {
  const xy = (p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.y]);
  const lines = (polylines || [])
    .filter((pl) => pl && pl.length >= 2)
    .map((pl) => pl.map(xy));
  if (lines.length < 2) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const pl of lines)
    for (const [x, y] of pl) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  // Treat two endpoints as the same vertex within a small fraction of the extent,
  // so a visually-closed loop counts even if its corners aren't bit-identical.
  const diag = Math.hypot(maxX - minX, maxY - minY) || 1;
  const t2 = (tol ?? Math.max(1e-6, diag * 1e-3)) ** 2;
  const eq = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 <= t2;

  const used = new Array(lines.length).fill(false);
  used[0] = true;
  const loop = lines[0].slice();
  for (let step = 0; step < lines.length; step++) {
    const tail = loop[loop.length - 1];
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (used[i]) continue;
      const pl = lines[i];
      if (eq(tail, pl[0])) {
        for (let k = 1; k < pl.length; k++) loop.push(pl[k]);
      } else if (eq(tail, pl[pl.length - 1])) {
        for (let k = pl.length - 2; k >= 0; k--) loop.push(pl[k]);
      } else continue;
      used[i] = true;
      found = true;
      break;
    }
    if (!found) break;
  }
  if (used.some((u) => !u)) return null; // pieces don't all connect → not one loop
  if (!eq(loop[0], loop[loop.length - 1])) return null; // chain never closed
  let A = 0;
  for (let i = 0; i < loop.length - 1; i++)
    A += loop[i][0] * loop[i + 1][1] - loop[i + 1][0] * loop[i][1];
  return Math.abs(A) / 2;
}

// The point a measurement runs FROM and TO. A vertex is itself; a line is the
// point halfway ALONG it; a face (or a closed loop, or a sampled object) is the
// centre of its extent.
//
// Not the nearest points between the two entities: that answers a different
// question -- how close they come -- and it makes the reading depend on where
// in a face or along an edge the user happened to click, so the same two faces
// measure differently from one click to the next.
//
// The centre of an extent is taken from the bounding box rather than the mean
// of the sampled points, because a mean is pulled towards wherever the
// tessellation put more vertices.
function extentCentre(pts) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    const v = v3(p);
    lo[0] = Math.min(lo[0], v.x);
    hi[0] = Math.max(hi[0], v.x);
    lo[1] = Math.min(lo[1], v.y);
    hi[1] = Math.max(hi[1], v.y);
    lo[2] = Math.min(lo[2], v.z);
    hi[2] = Math.max(hi[2], v.z);
  }
  return new THREE.Vector3(
    (lo[0] + hi[0]) / 2,
    (lo[1] + hi[1]) / 2,
    (lo[2] + hi[2]) / 2,
  );
}

// Half way along a chain by ARC LENGTH, so a curved edge anchors on the middle
// of the curve rather than the middle of its chord.
function midAlong(pts) {
  const v = pts.map(v3);
  if (v.length === 1) return v[0].clone();
  let total = 0;
  for (let i = 1; i < v.length; i++) total += v[i].distanceTo(v[i - 1]);
  let walked = 0;
  for (let i = 1; i < v.length; i++) {
    const step = v[i].distanceTo(v[i - 1]);
    if (walked + step >= total / 2) {
      const t = step > 1e-12 ? (total / 2 - walked) / step : 0;
      return v[i - 1].clone().lerp(v[i], t);
    }
    walked += step;
  }
  return v[v.length - 1].clone();
}

export function anchorOf(e) {
  if (!e) return null;
  if (e.kind === "point") return v3(e.p);
  if (e.kind === "segment") return v3(e.a).clone().lerp(v3(e.b), 0.5);
  if (e.kind === "polyline") {
    const pts = e.pts || [];
    if (pts.length === 0) return null;
    // A closed loop has no meaningful half-way point; use its centre.
    return e.closed ? extentCentre(pts) : midAlong(pts);
  }
  const pts = e.pts || [];
  return pts.length ? extentCentre(pts) : null;
}

export function measure(entities) {
  const es = (entities || []).filter(Boolean);
  if (es.length === 0) return null;
  if (es.length >= 2) {
    const a = anchorOf(es[0]);
    const b = anchorOf(es[1]);
    if (!a || !b) return null;
    return { type: "distance", value: a.distanceTo(b) };
  }
  const e = es[0];
  if (e.kind === "segment")
    return { type: "length", value: v3(e.a).distanceTo(v3(e.b)) };
  if (e.kind === "polyline")
    return { type: "length", value: polylineLength(e.pts.map(v3), e.closed) };
  if (e.kind === "face") return { type: "faceDims", ...faceDimensions(e) };
  return null;
}
