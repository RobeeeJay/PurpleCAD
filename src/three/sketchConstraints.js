import { getShapePoint, moveShapePoint } from "./sceneObjects.js";
import { resolveConstraintDistance } from "./geometryParams.js";

// Force-re-solve a sketch's distance constraints when their evaluated
// values may have changed (e.g. after a variable edit).  For every
// distance constraint whose current geometry doesn't match the resolved
// distance, treat pointA as the anchor and move pointB to the correct
// distance, then propagate through coincident constraints.  Returns the
// new shapes array; returns `null` if nothing changed.  Pass an explicit
// `variables` Map when the store's globally-active variables haven't yet
// been updated (e.g. inside a setVariables set() callback).
export function resolveDistanceConstraints(
  inputShapes,
  constraints,
  variables = null,
) {
  if (!constraints || constraints.length === 0) return null;
  let shapes = inputShapes.slice();
  let anyChange = false;
  const tol = 1e-5;
  for (const c of constraints) {
    if (c.type !== "distance") continue;
    const target = resolveConstraintDistance(c, variables);
    if (!(target > 0)) continue;
    const sA = shapes[c.shapeAIdx];
    const sB = shapes[c.shapeBIdx];
    if (!sA || !sB) continue;
    const pA = getShapePoint(sA, c.pointA);
    const pB = getShapePoint(sB, c.pointB);
    if (!pA || !pB) continue;
    const dx = pB.x - pA.x,
      dy = pB.y - pA.y;
    const cur = Math.hypot(dx, dy);
    if (cur < 1e-10) continue;
    if (Math.abs(cur - target) < tol) continue;
    const newPt = {
      x: pA.x + (dx / cur) * target,
      y: pA.y + (dy / cur) * target,
    };
    // Same-shape (line-length / radius): slide pointB endpoint on the
    // same shape.  Two-shape: move pointB on shapeB.
    const targetIdx = c.shapeBIdx;
    const targetKey = c.pointB;
    const baseShape = shapes[targetIdx];
    let moved = moveShapePoint(baseShape, targetKey, newPt);
    if (!moved) continue;
    if (moved.type === "circle" && targetKey === "center") {
      moved = { ...moved, r: target };
    }
    moved = applyHVEnforcement(moved, targetKey, constraints, targetIdx);
    // Propagate via enforceConstraints with this as the primary move.
    const after = enforceConstraints(
      shapes,
      constraints,
      targetIdx,
      moved,
      targetKey,
    );
    for (const [idx, s] of after) shapes[idx] = s;
    anyChange = true;
  }
  return anyChange ? shapes : null;
}

// All valid endpoint key names across all sketch shape types.
export const SHAPE_KEYS = [
  "start",
  "end",
  "tl",
  "tr",
  "br",
  "bl",
  "center",
  "p0",
  "p1",
  "p2",
  "p3",
];

// Enforce horizontal/vertical constraints on a line after one endpoint was moved.
// movedKey is the endpoint that was placed ("start", "end", or null for whole-shape).
export function applyHVEnforcement(shape, movedKey, constraints, shapeIdx) {
  if (shape.type !== "line") return shape;
  let result = shape;
  for (const c of constraints) {
    if (c.shapeIdx !== shapeIdx) continue;
    if (c.type === "horizontal") {
      const y =
        movedKey === "start"
          ? result.y1
          : movedKey === "end"
            ? result.y2
            : (result.y1 + result.y2) / 2;
      result = { ...result, y1: y, y2: y };
    } else if (c.type === "vertical") {
      const x =
        movedKey === "start"
          ? result.x1
          : movedKey === "end"
            ? result.x2
            : (result.x1 + result.x2) / 2;
      result = { ...result, x1: x, x2: x };
    }
  }
  return result;
}

// Project a 2D point onto the line segment defined by a line shape.
// t is clamped to [0,1] so the result always lies between the two endpoints.
export function projectOntoLine(pt, lineShape) {
  const ABx = lineShape.x2 - lineShape.x1,
    ABy = lineShape.y2 - lineShape.y1;
  const len2 = ABx * ABx + ABy * ABy;
  if (len2 < 1e-10) return { x: lineShape.x1, y: lineShape.y1 };
  const t = Math.max(
    0,
    Math.min(
      1,
      ((pt.x - lineShape.x1) * ABx + (pt.y - lineShape.y1) * ABy) / len2,
    ),
  );
  return { x: lineShape.x1 + t * ABx, y: lineShape.y1 + t * ABy };
}

// Normalize a 2D vector, returning the original if it has near-zero length.
export function norm2(v) {
  const l = Math.hypot(v.x, v.y);
  return l < 1e-10 ? v : { x: v.x / l, y: v.y / l };
}

// Build the arc geometry for a bevel/fillet between two trimmed lines.
export function buildBevelArc(P, uA, uB, trimA, trimB) {
  const toB = { x: trimB.x - trimA.x, y: trimB.y - trimA.y };
  const pA1 = { x: -uA.y, y: uA.x },
    pA2 = { x: uA.y, y: -uA.x };
  const pA = pA1.x * toB.x + pA1.y * toB.y > 0 ? pA1 : pA2;
  const toA = { x: trimA.x - trimB.x, y: trimA.y - trimB.y };
  const pB1 = { x: -uB.y, y: uB.x },
    pB2 = { x: uB.y, y: -uB.x };
  const pB = pB1.x * toA.x + pB1.y * toA.y > 0 ? pB1 : pB2;
  const dx = trimB.x - trimA.x,
    dy = trimB.y - trimA.y;
  const denom = pA.x * pB.y - pA.y * pB.x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = (dx * pB.y - dy * pB.x) / denom;
  const cx = trimA.x + t * pA.x,
    cy = trimA.y + t * pA.y;
  const r = Math.hypot(cx - trimA.x, cy - trimA.y);
  const startAngle = Math.atan2(trimA.y - cy, trimA.x - cx);
  const rawEnd = Math.atan2(trimB.y - cy, trimB.x - cx);
  const ccwSpan = (rawEnd - startAngle + 2 * Math.PI) % (2 * Math.PI);
  const cwSpan = 2 * Math.PI - ccwSpan;
  const midCW = startAngle - cwSpan / 2;
  const midCCW = startAngle + ccwSpan / 2;
  const dCW = Math.hypot(
    cx + r * Math.cos(midCW) - P.x,
    cy + r * Math.sin(midCW) - P.y,
  );
  const dCCW = Math.hypot(
    cx + r * Math.cos(midCCW) - P.x,
    cy + r * Math.sin(midCCW) - P.y,
  );
  const endAngle = dCW < dCCW ? startAngle - cwSpan : startAngle + ccwSpan;
  return { type: "arc", cx, cy, r, startAngle, endAngle };
}

// BFS over coincident constraints from startIdx to propagate a newly placed position
// to all connected shapes not yet in `updated`. Uses per-shape guard — safe for
// post-enforcement cleanup passes where we just need to keep attached shapes in sync.
function propagateCoincidentFrom(startIdx, shapes, updated, constraints) {
  const queue = [startIdx];
  while (queue.length > 0) {
    const idx = queue.shift();
    const cur = shapes[idx];
    if (!cur) continue;
    for (const c of constraints) {
      if (c.type !== "coincident") continue;
      let oIdx, oKey, tKey;
      if (c.shapeAIdx === idx && !updated.has(c.shapeBIdx)) {
        oIdx = c.shapeBIdx;
        oKey = c.pointB;
        tKey = c.pointA;
      } else if (c.shapeBIdx === idx && !updated.has(c.shapeAIdx)) {
        oIdx = c.shapeAIdx;
        oKey = c.pointA;
        tKey = c.pointB;
      } else continue;
      const pos = getShapePoint(cur, tKey);
      if (!pos) continue;
      const base = shapes[oIdx];
      if (!base) continue;
      let moved = moveShapePoint(base, oKey, pos);
      if (!moved) continue;
      moved = applyHVEnforcement(moved, oKey, constraints, oIdx);
      shapes[oIdx] = moved;
      updated.set(oIdx, moved);
      queue.push(oIdx);
    }
  }
}

// Pure constraint solver. Takes shapes and constraints arrays directly (no store access).
// Returns a Map<shapeIdx, shape> of every shape whose position changed.
//
// primaryPointKey: the specific endpoint key moved on the primary shape,
//   or null when the whole shape was translated (preserves length constraints).
// preSeeded: Map<shapeIdx, shape> of shapes already translated before the BFS starts
//   (used for shape-body drag with a rigid group).
export function enforceConstraints(
  inputShapes,
  constraints,
  primaryIdx,
  primaryShape,
  primaryPointKey = null,
  preSeeded = null,
) {
  const shapes = inputShapes.slice();

  if (preSeeded) {
    for (const [idx, s] of preSeeded) shapes[idx] = s;
  }
  shapes[primaryIdx] = primaryShape;

  const updated = preSeeded ? new Map(preSeeded) : new Map();
  updated.set(primaryIdx, primaryShape);
  // movedKey per shape: which endpoint was explicitly placed (null = whole-shape translate).
  // Used by same-shape distance enforcement to identify the fixed anchor endpoint.
  const movedKeys = new Map([[primaryIdx, primaryPointKey]]);

  // Per-endpoint tracking for the main coincident BFS. Finer than per-shape `updated`:
  // allows a shape's two endpoints to be placed independently from different sources,
  // which is necessary when two rigid shapes each connect to a different endpoint of
  // the same non-rigid shape (e.g. two sides of a rectangle both moving).
  const placedEP = new Set();
  const epKey = (idx, key) => `${idx}:${key}`;

  if (preSeeded) {
    for (const [idx] of preSeeded) {
      for (const k of SHAPE_KEYS) placedEP.add(epKey(idx, k));
    }
  }
  if (primaryPointKey) {
    placedEP.add(epKey(primaryIdx, primaryPointKey));
  } else {
    for (const k of SHAPE_KEYS) placedEP.add(epKey(primaryIdx, k));
  }

  // ── Main coincident BFS ──────────────────────────────────────────────────────
  const queue = preSeeded
    ? [primaryIdx, ...[...preSeeded.keys()].filter((k) => k !== primaryIdx)]
    : [primaryIdx];
  while (queue.length > 0) {
    const idx = queue.shift();
    const cur = shapes[idx];
    if (!cur) continue;
    for (const c of constraints) {
      if (c.type !== "coincident") continue;
      let otherIdx, otherKey, thisKey;
      if (c.shapeAIdx === idx && !placedEP.has(epKey(c.shapeBIdx, c.pointB))) {
        otherIdx = c.shapeBIdx;
        otherKey = c.pointB;
        thisKey = c.pointA;
      } else if (
        c.shapeBIdx === idx &&
        !placedEP.has(epKey(c.shapeAIdx, c.pointA))
      ) {
        otherIdx = c.shapeAIdx;
        otherKey = c.pointA;
        thisKey = c.pointB;
      } else continue;
      const pos = getShapePoint(cur, thisKey);
      if (!pos) continue;
      const base = shapes[otherIdx];
      if (!base) continue;
      let moved = moveShapePoint(base, otherKey, pos);
      if (!moved) continue;
      const preHV = moved;
      moved = applyHVEnforcement(moved, otherKey, constraints, otherIdx);
      // Skip no-op placements so shapes stay out of `updated` until they genuinely
      // move — keeping them reachable by the distance-enforcement inner BFS.
      const oldPt = getShapePoint(base, otherKey);
      const newPt = getShapePoint(moved, otherKey);
      if (
        oldPt &&
        newPt &&
        Math.hypot(newPt.x - oldPt.x, newPt.y - oldPt.y) < 1e-8
      )
        continue;
      shapes[otherIdx] = moved;
      updated.set(otherIdx, moved);
      movedKeys.set(otherIdx, otherKey);
      placedEP.add(epKey(otherIdx, otherKey));
      queue.push(otherIdx);
      // If H/V enforcement also shifted the OTHER endpoint, propagate that side-effect
      // so shapes connected to it stay attached.
      if (moved.type === "line") {
        const sideKey = otherKey === "start" ? "end" : "start";
        const preSidePos = getShapePoint(preHV, sideKey);
        const postSidePos = getShapePoint(moved, sideKey);
        if (
          preSidePos &&
          postSidePos &&
          Math.hypot(
            preSidePos.x - postSidePos.x,
            preSidePos.y - postSidePos.y,
          ) > 1e-8
        ) {
          for (const sc of constraints) {
            if (sc.type !== "coincident") continue;
            let sOtherIdx, sOtherKey;
            if (
              sc.shapeAIdx === otherIdx &&
              sc.pointA === sideKey &&
              !placedEP.has(epKey(sc.shapeBIdx, sc.pointB))
            ) {
              sOtherIdx = sc.shapeBIdx;
              sOtherKey = sc.pointB;
            } else if (
              sc.shapeBIdx === otherIdx &&
              sc.pointB === sideKey &&
              !placedEP.has(epKey(sc.shapeAIdx, sc.pointA))
            ) {
              sOtherIdx = sc.shapeAIdx;
              sOtherKey = sc.pointA;
            } else continue;
            const sBase = shapes[sOtherIdx];
            if (!sBase) continue;
            let sMoved = moveShapePoint(sBase, sOtherKey, postSidePos);
            if (!sMoved) continue;
            sMoved = applyHVEnforcement(
              sMoved,
              sOtherKey,
              constraints,
              sOtherIdx,
            );
            const wasInUpdated = updated.has(sOtherIdx);
            shapes[sOtherIdx] = sMoved;
            updated.set(sOtherIdx, sMoved);
            placedEP.add(epKey(sOtherIdx, sOtherKey));
            if (!wasInUpdated) queue.push(sOtherIdx);
          }
        }
      }
    }
  }

  // ── onLine enforcement ───────────────────────────────────────────────────────
  for (const c of constraints) {
    if (c.type !== "onLine") continue;
    if (!updated.has(c.lineShapeIdx) && !updated.has(c.pointShapeIdx)) continue;
    const lineShape = shapes[c.lineShapeIdx];
    const ptShape = shapes[c.pointShapeIdx];
    if (!lineShape || lineShape.type !== "line" || !ptShape) continue;
    const currentPt = getShapePoint(ptShape, c.pointKey);
    if (!currentPt) continue;
    const projected = projectOntoLine(currentPt, lineShape);
    if (Math.hypot(projected.x - currentPt.x, projected.y - currentPt.y) < 1e-8)
      continue;
    let newPtShape = moveShapePoint(ptShape, c.pointKey, projected);
    if (!newPtShape) continue;
    newPtShape = applyHVEnforcement(
      newPtShape,
      c.pointKey,
      constraints,
      c.pointShapeIdx,
    );
    shapes[c.pointShapeIdx] = newPtShape;
    updated.set(c.pointShapeIdx, newPtShape);
    propagateCoincidentFrom(c.pointShapeIdx, shapes, updated, constraints);
  }

  // ── Distance enforcement (up to 4 iterative passes) ─────────────────────────
  for (let pass = 0; pass < 4; pass++) {
    let anyChange = false;
    for (const c of constraints) {
      if (c.type !== "distance") continue;
      const { shapeAIdx: ai, pointA: pA, shapeBIdx: bi, pointB: pB } = c;
      const d = resolveConstraintDistance(c);
      if (!(d > 0)) continue;

      if (ai === bi) {
        // Same-shape: line-length or radius. The placed endpoint is the anchor;
        // slide the other to reach the constrained distance.
        if (!updated.has(ai)) continue;
        const movedKey = movedKeys.get(ai);
        if (!movedKey) continue; // whole-shape translate preserves length
        const shape = shapes[ai];
        if (!shape) continue;
        const adjustKey = movedKey === pA ? pB : pA;
        const fixedPos = getShapePoint(shape, movedKey);
        const adjustPos = getShapePoint(shape, adjustKey);
        if (!fixedPos || !adjustPos) continue;
        const ddx = adjustPos.x - fixedPos.x,
          ddy = adjustPos.y - fixedPos.y;
        const curLen = Math.hypot(ddx, ddy);
        if (curLen < 1e-10 || Math.abs(curLen - d) < 1e-8) continue;
        const newAdjPos = {
          x: fixedPos.x + (ddx / curLen) * d,
          y: fixedPos.y + (ddy / curLen) * d,
        };
        let ns = moveShapePoint(shape, adjustKey, newAdjPos);
        if (!ns) continue;
        // moveShapePoint(circle, 'center') doesn't update r, so set it explicitly.
        if (ns.type === "circle" && adjustKey === "center")
          ns = { ...ns, r: d };
        ns = applyHVEnforcement(ns, adjustKey, constraints, ai);
        shapes[ai] = ns;
        updated.set(ai, ns);
        movedKeys.set(ai, movedKey);
        anyChange = true;
        propagateCoincidentFrom(ai, shapes, updated, constraints);
      } else {
        // Two-shape: point-to-point distance. Move whichever endpoint was not
        // the original source of movement (only one side updated → move the other).
        const aUp = updated.has(ai),
          bUp = updated.has(bi);
        if (!aUp && !bUp) continue;
        if (aUp && bUp) continue; // both moved — skip to avoid fighting
        const sA = shapes[ai],
          sB = shapes[bi];
        if (!sA || !sB) continue;
        const posA = getShapePoint(sA, pA),
          posB = getShapePoint(sB, pB);
        if (!posA || !posB) continue;
        const dx = posB.x - posA.x,
          dy = posB.y - posA.y;
        const curDist = Math.hypot(dx, dy);
        if (curDist < 1e-10 || Math.abs(curDist - d) < 1e-8) continue;
        let targetIdx, targetKey, newX, newY;
        if (aUp) {
          targetIdx = bi;
          targetKey = pB;
          newX = posA.x + (dx / curDist) * d;
          newY = posA.y + (dy / curDist) * d;
        } else {
          targetIdx = ai;
          targetKey = pA;
          newX = posB.x - (dx / curDist) * d;
          newY = posB.y - (dy / curDist) * d;
        }
        let dMoved = moveShapePoint(shapes[targetIdx], targetKey, {
          x: newX,
          y: newY,
        });
        if (!dMoved) continue;
        dMoved = applyHVEnforcement(dMoved, targetKey, constraints, targetIdx);
        shapes[targetIdx] = dMoved;
        updated.set(targetIdx, dMoved);
        anyChange = true;
        propagateCoincidentFrom(targetIdx, shapes, updated, constraints);
      }
    }
    if (!anyChange) break;
  }

  // ── Bevel arc recomputation ──────────────────────────────────────────────────
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (!shape || shape.kind !== "bevel" || !shape.bevelData) continue;
    const { aIdx, aKey, bIdx, bKey, dist: bDist } = shape.bevelData;
    if (!updated.has(aIdx) && !updated.has(bIdx)) continue;
    const sA2 = shapes[aIdx],
      sB2 = shapes[bIdx];
    if (!sA2 || sA2.type !== "line" || !sB2 || sB2.type !== "line") continue;
    const aEnd =
      aKey === "start" ? { x: sA2.x1, y: sA2.y1 } : { x: sA2.x2, y: sA2.y2 };
    const aOther =
      aKey === "start" ? { x: sA2.x2, y: sA2.y2 } : { x: sA2.x1, y: sA2.y1 };
    const bEnd =
      bKey === "start" ? { x: sB2.x1, y: sB2.y1 } : { x: sB2.x2, y: sB2.y2 };
    const bOther =
      bKey === "start" ? { x: sB2.x2, y: sB2.y2 } : { x: sB2.x1, y: sB2.y1 };
    const dx1 = aEnd.x - aOther.x,
      dy1 = aEnd.y - aOther.y;
    const dx2 = bEnd.x - bOther.x,
      dy2 = bEnd.y - bOther.y;
    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) < 1e-10) continue;
    const tInter =
      ((bOther.x - aOther.x) * dy2 - (bOther.y - aOther.y) * dx2) / denom;
    const P = { x: aOther.x + tInter * dx1, y: aOther.y + tInter * dy1 };
    const uA = norm2({ x: aOther.x - P.x, y: aOther.y - P.y });
    const uB = norm2({ x: bOther.x - P.x, y: bOther.y - P.y });
    const newTrimA = { x: P.x + uA.x * bDist, y: P.y + uA.y * bDist };
    const newTrimB = { x: P.x + uB.x * bDist, y: P.y + uB.y * bDist };
    const newArc = buildBevelArc(P, uA, uB, newTrimA, newTrimB);
    if (!newArc) continue;
    newArc.kind = "bevel";
    newArc.bevelData = shape.bevelData;
    shapes[i] = newArc;
    updated.set(i, newArc);
    const newSA = moveShapePoint(sA2, aKey, newTrimA);
    const newSB = moveShapePoint(sB2, bKey, newTrimB);
    if (newSA) {
      shapes[aIdx] = newSA;
      updated.set(aIdx, newSA);
    }
    if (newSB) {
      shapes[bIdx] = newSB;
      updated.set(bIdx, newSB);
    }
  }

  return updated;
}
