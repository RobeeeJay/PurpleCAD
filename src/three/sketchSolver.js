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

// Which scalar fields of a shape the solver may move, in a stable order.
function varFields(s) {
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
    }
  }
  return out;
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
    for (let j = 0; j < N; j++)
      r.push((xv[j] - x0[j]) * (isFixed[j] ? fixedW : regW));
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
  const finalShapes = shapesAt(x);
  const finalRes = residuals(finalShapes, cs, variables);
  let maxResidual = 0;
  for (const v of finalRes) maxResidual = Math.max(maxResidual, Math.abs(v));
  return { shapes: finalShapes, ok: maxResidual < successTol, maxResidual };
}
