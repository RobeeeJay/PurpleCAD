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

// Area (shoelace) centroid — the centroid of the FILLED region, which is
// invariant to vertex density (adding points along an edge doesn't move it).
// polyCentroid is the vertex MEAN, which shifts when a curve (arc / bezier) is
// re-tessellated at a different resolution; using that to position an extrude
// makes the solid drift on a preview/print toggle.  Falls back to the vertex
// mean for a degenerate (zero-area) loop.
export function polyAreaCentroid(poly) {
  let a2 = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i],
      q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a2) < 1e-12) return polyCentroid(poly);
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

// Which point an extrude's stored profile should be matched against when its
// loop is re-derived from the live sketch.  `profileCentroid` is the point that
// was CLICKED when the extrude was made (deliberately, since a click is always
// inside its own region while a centroid need not be) and nothing moves it when
// the sketch is edited.  Once an edit has taken the shape out from under it,
// the anchor is a bare coordinate in the sketch — and a shape drawn there LATER
// swallows it, handing the extrude to that shape.  So an anchor that no longer
// lies inside its own stored polygon is stale: fall back to the polygon's own
// centroid, which moves with the shape, and tell the caller not to trust a
// containment test with it.
export function profileAnchor(profile) {
  const poly = profile?.polygon2D;
  const pc = profile?.profileCentroid;
  if (!Array.isArray(poly) || poly.length < 3) return { pc, inside: !!pc };
  if (pc && polyContainsPoint(poly, pc)) return { pc, inside: true };
  return { pc: polyCentroid(poly), inside: false };
}

export function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a) / 2;
}
