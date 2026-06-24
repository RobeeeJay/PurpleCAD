// Numerical least-squares constraint solver.  Where enforceConstraints
// (sketchConstraints.js) propagates one move through coincident/H-V/distance
// rules — fast and good for live drags but unable to resolve a coupled system
// like "resize one side of a right-angled quad" — this solves ALL constraints
// at once: every coordinate is a variable, each constraint is a residual that
// is zero when satisfied, and a Levenberg-Marquardt iteration drives the
// residuals to zero.  A weak pull toward the starting positions breaks the
// rigid-motion gauge freedom so the result is the valid configuration nearest
// the current one (and fixed points stay put).

import { resolveConstraintDistance } from "./geometryParams.js";
import { rederiveAllCorners } from "./sketchGeometry.js";

// Which scalar fields of a shape the solver may move, in a stable order.
export function varFields(s) {
  switch (s?.type) {
    case "line":
    case "rect":
      return ["x1", "y1", "x2", "y2"];
    case "circle":
      return ["cx", "cy", "r"];
    case "ellipse":
      return ["cx", "cy", "rx", "ry", "rotation"];
    case "arc":
      return ["cx", "cy", "r", "startAngle", "endAngle"];
    case "point":
      return ["x", "y"];
    default:
      return []; // bezier & unknowns: treated as fixed
  }
}

// The variable fields backing a point key — used to pin (anchor) that point.
export function fieldsForPoint(shape, key) {
  if (!shape) return [];
  if (shape.type === "line")
    return key === "start" ? ["x1", "y1"] : key === "end" ? ["x2", "y2"] : [];
  if (shape.type === "rect") {
    if (key === "tl") return ["x1", "y1"];
    if (key === "tr") return ["x2", "y1"];
    if (key === "br") return ["x2", "y2"];
    if (key === "bl") return ["x1", "y2"];
    return [];
  }
  if (
    shape.type === "circle" ||
    shape.type === "ellipse" ||
    shape.type === "arc"
  )
    return key === "center" ? ["cx", "cy"] : [];
  if (shape.type === "point") return ["x", "y"];
  return [];
}

// Point coordinates referenced by constraints, as a function of the shape.
function pointOf(s, key) {
  if (!s) return null;
  if (s.type === "line") {
    if (key === "start") return { x: s.x1, y: s.y1 };
    if (key === "end") return { x: s.x2, y: s.y2 };
  } else if (s.type === "rect") {
    if (key === "tl") return { x: s.x1, y: s.y1 };
    if (key === "tr") return { x: s.x2, y: s.y1 };
    if (key === "br") return { x: s.x2, y: s.y2 };
    if (key === "bl") return { x: s.x1, y: s.y2 };
  } else if (s.type === "circle" || s.type === "ellipse") {
    if (key === "center") return { x: s.cx, y: s.cy };
    if (key === "edge") return { x: s.cx + (s.r ?? s.rx ?? 0), y: s.cy };
  } else if (s.type === "arc") {
    if (key === "center") return { x: s.cx, y: s.cy };
    if (key === "start")
      return {
        x: s.cx + Math.cos(s.startAngle) * s.r,
        y: s.cy + Math.sin(s.startAngle) * s.r,
      };
    if (key === "end")
      return {
        x: s.cx + Math.cos(s.endAngle) * s.r,
        y: s.cy + Math.sin(s.endAngle) * s.r,
      };
  } else if (s.type === "bezier") {
    if (key === "p0") return { x: s.p0.x, y: s.p0.y };
    if (key === "p3") return { x: s.p3.x, y: s.p3.y };
  } else if (s.type === "point") {
    return { x: s.x, y: s.y };
  }
  return null;
}

// Residual vector for the constraint set (each entry is 0 when satisfied).
function residuals(shapes, constraints, variables) {
  const out = [];
  for (const c of constraints) {
    if (c.type === "coincident") {
      const a = pointOf(shapes[c.shapeAIdx], c.pointA);
      const b = pointOf(shapes[c.shapeBIdx], c.pointB);
      if (a && b) out.push(a.x - b.x, a.y - b.y);
      else out.push(0, 0);
    } else if (c.type === "distance") {
      const d = resolveConstraintDistance(c, variables);
      if (!(d > 0)) continue;
      if (c.shapeAIdx === c.shapeBIdx && c.pointB === "edge") {
        const s = shapes[c.shapeAIdx];
        out.push((s?.r ?? s?.rx ?? 0) - d);
      } else {
        const a = pointOf(shapes[c.shapeAIdx], c.pointA);
        const b = pointOf(shapes[c.shapeBIdx], c.pointB);
        if (a && b) out.push(Math.hypot(a.x - b.x, a.y - b.y) - d);
        else out.push(0);
      }
    } else if (c.type === "horizontal") {
      const s = shapes[c.shapeIdx];
      out.push(s?.type === "line" ? s.y1 - s.y2 : 0);
    } else if (c.type === "vertical") {
      const s = shapes[c.shapeIdx];
      out.push(s?.type === "line" ? s.x1 - s.x2 : 0);
    } else if (c.type === "onLine") {
      const ln = shapes[c.lineShapeIdx];
      const p = pointOf(shapes[c.pointShapeIdx], c.pointKey);
      if (ln?.type === "line" && p) {
        const dx = ln.x2 - ln.x1,
          dy = ln.y2 - ln.y1;
        const len = Math.hypot(dx, dy) || 1e-9;
        out.push(((p.x - ln.x1) * dy - (p.y - ln.y1) * dx) / len);
      } else out.push(0);
    } else if (c.type === "offset") {
      // Parametric offset of a NEW line from its ORIGINAL: keep them parallel
      // and at a fixed signed perpendicular distance.  Two residuals: the
      // direction cross-product (parallel) and the start point's perpendicular
      // distance to the original (= the offset).  The corner coincident
      // constraints supply the remaining DOF, so the offset follows edits to
      // the original.
      const nl = shapes[c.shapeIdx];
      const ol = shapes[c.origIdx];
      if (nl?.type === "circle" && ol?.type === "circle") {
        // Concentric offset: the copy shares the original's centre and its
        // radius differs by the signed offset (positive = larger / outward).
        const d = resolveConstraintDistance(c, variables);
        out.push(nl.cx - ol.cx);
        out.push(nl.cy - ol.cy);
        out.push((nl.r ?? 0) - ((ol.r ?? 0) + d));
      } else if (nl?.type === "arc" && ol?.type === "arc") {
        // Concentric arc offset: shared centre + angles, radius offset by d.
        const d = resolveConstraintDistance(c, variables);
        out.push(nl.cx - ol.cx);
        out.push(nl.cy - ol.cy);
        out.push((nl.r ?? 0) - ((ol.r ?? 0) + d));
        out.push((nl.startAngle ?? 0) - (ol.startAngle ?? 0));
        out.push((nl.endAngle ?? 0) - (ol.endAngle ?? 0));
      } else if (nl?.type === "ellipse" && ol?.type === "ellipse") {
        // Concentric ellipse offset: shared centre + rotation, both semi-axes
        // grown by d (an approximation — a true ellipse offset isn't elliptic).
        const d = resolveConstraintDistance(c, variables);
        out.push(nl.cx - ol.cx);
        out.push(nl.cy - ol.cy);
        out.push((nl.rx ?? 0) - ((ol.rx ?? 0) + d));
        out.push((nl.ry ?? 0) - ((ol.ry ?? 0) + d));
        out.push((nl.rotation ?? 0) - (ol.rotation ?? 0));
      } else if (nl?.type === "line" && ol?.type === "line") {
        const ndx = nl.x2 - nl.x1,
          ndy = nl.y2 - nl.y1;
        const odx = ol.x2 - ol.x1,
          ody = ol.y2 - ol.y1;
        const nlen = Math.hypot(ndx, ndy) || 1e-9;
        const olen = Math.hypot(odx, ody) || 1e-9;
        // sin of the angle between the two directions → 0 when parallel.
        out.push((ndx * ody - ndy * odx) / (nlen * olen));
        const d = resolveConstraintDistance(c, variables);
        out.push(((nl.x1 - ol.x1) * ody - (nl.y1 - ol.y1) * odx) / olen - d);
      } else out.push(0, 0);
    } else if (c.type === "angle") {
      const target =
        ((typeof c.angle === "number" ? c.angle : parseFloat(c.angle)) *
          Math.PI) /
        180;
      const sA = shapes[c.shapeAIdx],
        sB = shapes[c.shapeBIdx];
      const P = pointOf(sA, c.pointA);
      const oA = pointOf(sA, c.pointA === "start" ? "end" : "start");
      const oB = pointOf(sB, c.pointB === "start" ? "end" : "start");
      if (P && oA && oB && Number.isFinite(target)) {
        let d =
          Math.atan2(oB.y - P.y, oB.x - P.x) -
          Math.atan2(oA.y - P.y, oA.x - P.x);
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        out.push(Math.abs(d) - target); // magnitude; sign kept by regularization
      } else out.push(0);
    } else if (c.type === "parallel" || c.type === "colinear") {
      // Two lines parallel: the direction cross-product → 0.  Colinear adds a
      // second residual — line B's start point lies on line A (perp dist 0).
      const a = shapes[c.shapeAIdx],
        b = shapes[c.shapeBIdx];
      if (a?.type === "line" && b?.type === "line") {
        const adx = a.x2 - a.x1,
          ady = a.y2 - a.y1,
          al = Math.hypot(adx, ady) || 1e-9;
        const bdx = b.x2 - b.x1,
          bdy = b.y2 - b.y1,
          bl = Math.hypot(bdx, bdy) || 1e-9;
        out.push((adx * bdy - ady * bdx) / (al * bl));
        if (c.type === "colinear")
          out.push(((b.x1 - a.x1) * ady - (b.y1 - a.y1) * adx) / al);
      } else out.push(0, ...(c.type === "colinear" ? [0] : []));
    } else if (c.type === "tangent") {
      // Line↔circle/arc: distance(centre, line) = radius.  Circle/arc↔circle/arc:
      // centre distance = r1+r2 (external) or |r1−r2| (internal), whichever fits.
      const a = shapes[c.shapeAIdx],
        b = shapes[c.shapeBIdx];
      const isArc = (s) => s?.type === "circle" || s?.type === "arc";
      const lineCircle = (ln, ci) => {
        const dx = ln.x2 - ln.x1,
          dy = ln.y2 - ln.y1,
          len = Math.hypot(dx, dy) || 1e-9;
        const d = ((ci.cx - ln.x1) * dy - (ci.cy - ln.y1) * dx) / len;
        return Math.abs(d) - (ci.r ?? 0);
      };
      if (a?.type === "line" && isArc(b)) out.push(lineCircle(a, b));
      else if (isArc(a) && b?.type === "line") out.push(lineCircle(b, a));
      else if (isArc(a) && isArc(b)) {
        const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        const ra = a.r ?? 0,
          rb = b.r ?? 0;
        const ext = dist - (ra + rb),
          int = dist - Math.abs(ra - rb);
        out.push(Math.abs(ext) <= Math.abs(int) ? ext : int);
      } else out.push(0);
    } else if (c.type === "equal") {
      // Two lines → equal length; two circles/arcs (incl. bevels) → equal radius.
      const a = shapes[c.shapeAIdx],
        b = shapes[c.shapeBIdx];
      if (a?.type === "line" && b?.type === "line")
        out.push(
          Math.hypot(a.x2 - a.x1, a.y2 - a.y1) -
            Math.hypot(b.x2 - b.x1, b.y2 - b.y1),
        );
      else out.push((a?.r ?? a?.rx ?? 0) - (b?.r ?? b?.rx ?? 0));
    }
  }
  return out;
}

// Hop distance (number of coupling constraints) from each shape to the nearest
// fixed shape.  Two shapes are coupled when a constraint references both; H/V
// constraints touch a single shape and add no edge.  Used during a drag to make
// far-away geometry stiffer than near geometry, so a drag is absorbed by the
// points closest to it and distant points stay put.  Shapes unreachable from
// the drag are Infinity (treated as maximally stiff).
export function shapeHopDistance(numShapes, constraints, fixedShapeIdxs) {
  const adj = Array.from({ length: numShapes }, () => []);
  const link = (a, b) => {
    if (a == null || b == null || a === b) return;
    if (a < 0 || b < 0 || a >= numShapes || b >= numShapes) return;
    adj[a].push(b);
    adj[b].push(a);
  };
  for (const c of constraints) {
    if (
      c.type === "coincident" ||
      c.type === "distance" ||
      c.type === "angle" ||
      c.type === "parallel" ||
      c.type === "colinear" ||
      c.type === "tangent" ||
      c.type === "equal"
    )
      link(c.shapeAIdx, c.shapeBIdx);
    else if (c.type === "onLine") link(c.lineShapeIdx, c.pointShapeIdx);
    else if (c.type === "offset") link(c.shapeIdx, c.origIdx);
  }
  const dist = new Array(numShapes).fill(Infinity);
  const queue = [];
  for (const i of fixedShapeIdxs)
    if (i >= 0 && i < numShapes && dist[i] !== 0) {
      dist[i] = 0;
      queue.push(i);
    }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (const j of adj[i])
      if (dist[j] > dist[i] + 1) {
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
  }
  return dist;
}

// Solve A·x = b in place (Gaussian elimination with partial pivoting).  A is
// N×N (row-major arrays), b length N.  Returns x, or null if singular.
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
  return x;
}

// Solve the constraint system.  options:
//   variables  - variable map for formula-valued distances/angles
//   fixed      - Set of "shapeIdx:field" coordinates to hold (e.g. a dragged point)
//   reg        - weak regularization weight toward the start positions
//   maxIter, successTol
// Returns { shapes, ok, maxResidual }.  ok is false if it couldn't get every
// constraint within successTol — the caller rejects the change in that case.
export function solveConstraints(inputShapes, constraints, options = {}) {
  const {
    variables = null,
    fixed = new Set(),
    // Very weak: just enough to break the rigid-motion gauge (pin the solution
    // near the start) without measurably resisting the actual constraints.
    reg = 1e-7,
    maxIter = 120,
    successTol = 1e-3,
  } = options;
  const base = inputShapes.map((s) => ({ ...s }));
  // Variable layout.
  const specs = [];
  base.forEach((s, i) => {
    for (const f of varFields(s)) specs.push({ i, f });
  });
  const N = specs.length;
  const cs = (constraints || []).filter((c) => c.type !== undefined);
  if (N === 0 || cs.length === 0)
    return { shapes: base, ok: true, maxResidual: 0 };

  let x = specs.map(({ i, f }) => base[i][f]);
  const x0 = x.slice();
  const regW = Math.sqrt(reg);
  const fixedW = 1e4;
  const isFixed = specs.map(({ i, f }) => fixed.has(`${i}:${f}`));

  // During a drag (a non-empty fixed set), pull distant geometry toward its
  // start position more firmly than nearby geometry: the regularization weight
  // grows with hop distance from the dragged shape, so the change is absorbed
  // by the nearest connected points and far points barely move.  All weights
  // stay far below the unit constraint weight, so this only chooses among
  // otherwise-equivalent solutions — it never fights a constraint.  With no
  // fixed set (e.g. a dimension edit) the weight is uniform, as before.
  const fixedShapeIdxs = new Set();
  for (const key of fixed) {
    const i = parseInt(key, 10);
    if (Number.isInteger(i)) fixedShapeIdxs.add(i);
  }
  const HOP_GROWTH = 4; // weight multiplier per hop away from the drag
  const HOP_MAX_MULT = 100; // cap so even far points stay well under weight 1
  const hop =
    fixedShapeIdxs.size > 0
      ? shapeHopDistance(base.length, cs, fixedShapeIdxs)
      : null;
  const regWeight = specs.map(({ i }, j) => {
    if (isFixed[j]) return fixedW;
    if (!hop) return regW;
    const d = hop[i];
    // The drag shape and its immediate neighbours are the freest (mult 1);
    // stiffness ramps up beyond them.  Unreachable geometry is maximally stiff.
    const steps = Number.isFinite(d) ? Math.max(0, d - 1) : Infinity;
    const mult = Math.min(HOP_MAX_MULT, HOP_GROWTH ** steps);
    return regW * mult;
  });

  const shapesAt = (xv) => {
    const out = base.map((s) => ({ ...s }));
    specs.forEach(({ i, f }, j) => {
      out[i][f] = xv[j];
    });
    return out;
  };
  // Full residual: constraints first, then one regularization row per variable.
  const fullRes = (xv) => {
    const r = residuals(shapesAt(xv), cs, variables);
    for (let j = 0; j < N; j++) r.push((xv[j] - x0[j]) * regWeight[j]);
    return r;
  };
  const cost = (r) => r.reduce((a, v) => a + v * v, 0);

  let lambda = 1e-3;
  let r = fullRes(x);
  let c = cost(r);
  const h = 1e-6;
  for (let iter = 0; iter < maxIter; iter++) {
    if (c < 1e-18) break;
    const M = r.length;
    // Numerical Jacobian J (M×N).
    const J = Array.from({ length: M }, () => new Array(N).fill(0));
    for (let j = 0; j < N; j++) {
      const xj = x.slice();
      xj[j] += h;
      const rj = fullRes(xj);
      for (let m = 0; m < M; m++) J[m][j] = (rj[m] - r[m]) / h;
    }
    // Normal equations: (JᵀJ + λ·diag(JᵀJ))·dx = -Jᵀr.
    const JtJ = Array.from({ length: N }, () => new Array(N).fill(0));
    const Jtr = new Array(N).fill(0);
    for (let a = 0; a < N; a++) {
      for (let b = a; b < N; b++) {
        let s = 0;
        for (let m = 0; m < M; m++) s += J[m][a] * J[m][b];
        JtJ[a][b] = s;
        JtJ[b][a] = s;
      }
      let g = 0;
      for (let m = 0; m < M; m++) g += J[m][a] * r[m];
      Jtr[a] = g;
    }
    const A = JtJ.map((row, a) =>
      row.map((v, b) => (a === b ? v + lambda * (v || 1) : v)),
    );
    const dx = solveLinear(
      A,
      Jtr.map((v) => -v),
    );
    if (!dx) {
      lambda *= 4;
      if (lambda > 1e9) break;
      continue;
    }
    const xNew = x.map((v, j) => v + dx[j]);
    const rNew = fullRes(xNew);
    const cNew = cost(rNew);
    if (cNew < c) {
      x = xNew;
      r = rNew;
      c = cNew;
      lambda = Math.max(1e-7, lambda * 0.5);
    } else {
      lambda *= 3;
      if (lambda > 1e9) break;
    }
  }
  // Repair any chamfer/bevel corners: the solver only pins a bridge's endpoints
  // to its legs, so a bevel arc's radius/centre drift free and the fillet breaks
  // as a connected line is dragged.  Re-deriving from the legs restores the proper
  // tangent arc (and the chamfer's exact setback) before residuals are scored.
  const finalShapes = rederiveAllCorners(shapesAt(x));
  const finalRes = residuals(finalShapes, cs, variables);
  let maxResidual = 0;
  for (const v of finalRes) maxResidual = Math.max(maxResidual, Math.abs(v));
  return { shapes: finalShapes, ok: maxResidual < successTol, maxResidual };
}
