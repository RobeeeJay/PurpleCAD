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

// The runs of a loop of `n` vertices once the loop is reversed: old edge k
// (v[k] -> v[k+1]) becomes edge n-2-k of the reversed loop.
export function reverseEdgeCurves(runs, n) {
  return (runs || []).map((run) => ({
    ...run,
    start: (((n - 1 - run.start - run.count) % n) + n) % n,
  }));
}

// The addon's packing of a loop's curve runs (BuildCurveWire): 11 numbers a
// run -- start, count, kind, then the curve's own numbers.
const CURVE_RUN_WIDTH = 11;
// interp: a smooth curve with no closed form, built through the run's own
// vertices (a cog's involute flank).
const CURVE_KIND = { arc: 1, bezier: 2, ellipse: 3, interp: 4 };
export function packCurveRuns(runs) {
  const out = new Float64Array(runs.length * CURVE_RUN_WIDTH);
  runs.forEach((run, i) => {
    const params =
      run.type === "arc"
        ? [run.cx, run.cy, run.r]
        : run.type === "ellipse"
          ? [run.cx, run.cy, run.rx, run.ry]
          : run.type === "bezier"
            ? [run.p0, run.p1, run.p2, run.p3].flatMap((p) => [p.x, p.y])
            : [];
    out.set(
      [run.start, run.count, CURVE_KIND[run.type], ...params],
      i * CURVE_RUN_WIDTH,
    );
  });
  return out;
}

// A loop wound as OCC wants it (outer CCW, holes CW), flattened for the
// addon, with its curve runs moved to match when it had to be reversed.
// `curves` null means "no exact curves": the addon builds the polygon.
export function windLoopForOcc(poly, runs, wantCcw) {
  const wound = windLoop(poly, runs, wantCcw);
  return {
    flat: new Float64Array(wound.pts.flatMap((p) => [p.x, p.y])),
    curves: wound.runs ? packCurveRuns(wound.runs) : null,
  };
}

// `poly` with the requested winding, and its curve runs moved to match.
export function windLoop(poly, runs, wantCcw) {
  const flip = signedPolyAreaXY(poly) > 0 !== wantCcw;
  return {
    pts: flip ? [...poly].reverse() : poly,
    runs: runs && flip ? reverseEdgeCurves(runs, poly.length) : runs,
  };
}

// The addon's packing of curves in WORLD space (BuildWorldCurveWire): 15
// numbers a run.  An arc and an interp need none -- each is built through its
// own vertices -- and a bezier's poles are mapped by `toWorld`.  An ellipse
// carries its centre, the world directions of its axes and its radii, since
// three points don't fix one.
const WORLD_RUN_WIDTH = 15;
export function packWorldCurveRuns(runs, toWorld) {
  const kept = runs || [];
  const w3 = (p) => {
    const w = toWorld(p);
    return [w.x, w.y, w.z];
  };
  const out = new Float64Array(kept.length * WORLD_RUN_WIDTH);
  kept.forEach((run, i) => {
    let poles = [];
    if (run.type === "bezier")
      poles = [run.p0, run.p1, run.p2, run.p3].flatMap(w3);
    else if (run.type === "ellipse") {
      const c = w3({ x: run.cx, y: run.cy });
      const ax = w3({ x: run.cx + 1, y: run.cy }).map((v, k) => v - c[k]);
      const ay = w3({ x: run.cx, y: run.cy + 1 }).map((v, k) => v - c[k]);
      poles = [...c, ...ax, ...ay, run.rx, run.ry];
    }
    out.set(
      [run.start, run.count, CURVE_KIND[run.type], ...poles],
      i * WORLD_RUN_WIDTH,
    );
  });
  return out;
}
