// Pure polygon utilities used by closed-loop detection and downstream
// extrude/fill code: winding (signed area), point-in-polygon, centroid, and
// unsigned area.  No THREE imports.

// Signed shoelace area: positive when the polygon is CCW (in a +Y-up
// Cartesian frame), negative when CW.  Used to normalize hole windings before
// handing them to THREE.ExtrudeGeometry — Three.js builds side-wall quads by
// walking each path in vertex order, so if a hole is CCW (same orientation as
// the outer boundary) the inner walls come out facing the wrong way.
export function signedPolyAreaXY(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

// Return `poly` with the requested winding (CCW when wantCcw=true, CW
// otherwise).  No-op when the polygon already matches.
export function withWinding(poly, wantCcw) {
  if (!poly || poly.length < 3) return poly;
  const isCcw = signedPolyAreaXY(poly) > 0;
  return isCcw === wantCcw ? poly : [...poly].reverse();
}

export function polyContainsPoint(poly, pt) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y,
      xj = poly[j].x,
      yj = poly[j].y;
    if (
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

export function polyCentroid(poly) {
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
    y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
  };
}

export function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a) / 2;
}
