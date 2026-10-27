// The regions a sketch's split shapes enclose, traced as the faces of their
// planar arrangement -- the linear alternative to enumerating every cycle,
// which findClosedLoopsWithShapes (closedLoops.js) falls back to on overlap --
// and the sampling that turns a loop's edges into a polygon with its exact
// curve runs.

import { arcSegsN, sampleShapeForPoly } from "./loopIntersect.js";
import { signedPolyAreaXY, reverseEdgeCurves } from "./polygonUtil.js";

// A loop's polygon is sampled from its curves, and OCC can only rebuild a
// curved face from the curve itself: a polygon makes N flat faces, which every
// later boolean keeps.  So each loop also records which of its edges lie on
// which exact curve -- edge k runs from vertex k to vertex k+1 (mod n), and a
// run covers `count` edges from `start`.  Straight edges carry no run.
function curveRun(shape, start, count) {
  if (count === 0) return null;
  if (shape.type === "arc")
    return {
      start,
      count,
      type: "arc",
      cx: shape.cx,
      cy: shape.cy,
      r: shape.r,
    };
  if (shape.type === "bezier") {
    const { p0, p1, p2, p3 } = shape;
    return {
      start,
      count,
      type: "bezier",
      p0: { x: p0.x, y: p0.y },
      p1: { x: p1.x, y: p1.y },
      p2: { x: p2.x, y: p2.y },
      p3: { x: p3.x, y: p3.y },
    };
  }
  return null;
}

// Sample `shape` onto the end of `polygon`, recording its curve run.
export function appendSamples(polygon, runs, shape, startIsA, N) {
  const pts = sampleShapeForPoly(shape, startIsA, N);
  const run = curveRun(shape, polygon.length, pts.length);
  if (run) runs.push(run);
  for (const p of pts) polygon.push(p);
}

// The bounded faces of a planar arrangement, plus each connected piece's outer
// outline: the regions you can see, not every union of them.  Linear in the
// edge count: every directed edge borders exactly one face, and walking "take
// the sharpest right turn" from it goes round that face.
export function arrangementFaces(
  shapeNodes,
  subEntries,
  nodes,
  curveSegments,
  precision,
  mergeThroughT,
) {
  const live = shapeNodes.map((sn) => !!sn && sn.a !== sn.b);
  // A dangling edge (a node of degree 1) bounds no region; tracing round it
  // would put a zero-width spike in a face that OCC's wire builder rejects.
  const degree = new Map();
  const bump = (n, d) => degree.set(n, (degree.get(n) || 0) + d);
  shapeNodes.forEach((sn, si) => {
    if (live[si]) {
      bump(sn.a, 1);
      bump(sn.b, 1);
    }
  });
  for (let pruned = true; pruned;) {
    pruned = false;
    shapeNodes.forEach((sn, si) => {
      if (live[si] && (degree.get(sn.a) === 1 || degree.get(sn.b) === 1)) {
        live[si] = false;
        bump(sn.a, -1);
        bump(sn.b, -1);
        pruned = true;
      }
    });
  }

  const segsOf = (sh) =>
    arcSegsN(
      sh,
      sh.type === "arc" ? Math.abs(sh.endAngle - sh.startAngle) : Math.PI,
      curveSegments,
      precision,
    );
  // Half-edge h = 2*si (a -> b) or 2*si + 1 (b -> a).  Its direction as it
  // leaves its node is taken from the curve's first sample, not the far end,
  // so two arcs leaving one point (circles crossing there) sort by where
  // they actually go.
  const tail = (h) => (h & 1 ? shapeNodes[h >> 1].b : shapeNodes[h >> 1].a);
  const head = (h) => (h & 1 ? shapeNodes[h >> 1].a : shapeNodes[h >> 1].b);
  const samples = (h) => {
    const sh = subEntries[h >> 1].shape;
    return sampleShapeForPoly(sh, (h & 1) === 0, Math.max(2, segsOf(sh)));
  };
  const out = new Map();
  shapeNodes.forEach((sn, si) => {
    if (!live[si]) return;
    for (const h of [si * 2, si * 2 + 1]) {
      const from = nodes[tail(h)];
      const pts = samples(h);
      const to = pts.length > 1 ? pts[1] : nodes[head(h)];
      const list = out.get(tail(h)) || [];
      list.push({ h, ang: Math.atan2(to.y - from.y, to.x - from.x) });
      out.set(tail(h), list);
    }
  });
  const slot = new Map();
  out.forEach((list) => {
    list.sort((p, q) => p.ang - q.ang);
    list.forEach((e, i) => slot.set(e.h, i));
  });
  // The face on h's left continues along the edge just clockwise of h's twin.
  const next = (h) => {
    const list = out.get(head(h));
    return list[(slot.get(h ^ 1) - 1 + list.length) % list.length].h;
  };

  const faces = [];
  const seen = new Set();
  out.forEach((list) => {
    for (const { h: start } of list) {
      if (seen.has(start)) continue;
      const walk = [];
      let h = start;
      while (!seen.has(h)) {
        seen.add(h);
        walk.push(h);
        h = next(h);
      }
      if (h !== start) continue;
      const polygon = [];
      const curves = [];
      const steps = walk.map((e) => ({
        si: e >> 1,
        fwd: (e & 1) === 0,
        from: tail(e),
      }));
      for (const { shape, fwd } of mergeThroughT(steps))
        appendSamples(polygon, curves, shape, fwd, Math.max(2, segsOf(shape)));
      const area = signedPolyAreaXY(polygon);
      const shapeIndices = [
        ...new Set(walk.map((e) => subEntries[e >> 1].origIdx)),
      ];
      // Counter-clockwise: a bounded face.  Clockwise: a piece's outline, kept
      // (reversed) when it is a simple loop, as the cycle search offered it.
      if (area > 1e-12) faces.push({ polygon, shapeIndices, curves });
      else if (area < -1e-12 && new Set(walk.map(tail)).size === walk.length)
        faces.push({
          polygon: polygon.slice().reverse(),
          shapeIndices,
          curves: reverseEdgeCurves(curves, polygon.length),
        });
    }
  });
  return faces;
}
