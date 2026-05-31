import { getShapePoint, moveShapePoint } from "./sceneObjects.js";
import { resolveConstraintDistance } from "./geometryParams.js";
// Used by the solver internals (onLine projection + bevel recompute); also
// re-exported below for consumers that import them from this module.
import { norm2, projectOntoLine, buildBevelArc } from "./sketchGeometry.js";

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

// Pure geometry helpers live in sketchGeometry.js.  Re-export the ones other
// modules import from here so their import paths stay unchanged.
export {
  norm2,
  projectOntoLine,
  computeChamfer,
  chamferConstraints,
  buildBevelArc,
} from "./sketchGeometry.js";

// BFS over coincident constraints from startIdx to propagate a newly placed position
// to all connected shapes.  Uses a local `visited` set (not the global `updated` map)
// so that shapes already processed by the main BFS can still be re-synchronised here
// after distance enforcement shifts an endpoint they share.
function propagateCoincidentFrom(startIdx, shapes, updated, constraints) {
  const visited = new Set();
  const queue = [startIdx];
  while (queue.length > 0) {
    const idx = queue.shift();
    if (visited.has(idx)) continue;
    visited.add(idx);
    const cur = shapes[idx];
    if (!cur) continue;
    for (const c of constraints) {
      if (c.type !== "coincident") continue;
      let oIdx, oKey, tKey;
      if (c.shapeAIdx === idx && !visited.has(c.shapeBIdx)) {
        oIdx = c.shapeBIdx;
        oKey = c.pointB;
        tKey = c.pointA;
      } else if (c.shapeBIdx === idx && !visited.has(c.shapeAIdx)) {
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

  // The drag inputs (primary + pre-seeded shapes) are fixed: the final
  // reconciliation pass must never move these, or it would undo the drag.
  const anchored = new Set(placedEP);

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
            movedKeys.set(sOtherIdx, sOtherKey);
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

  // ── Angle enforcement ────────────────────────────────────────────────────────
  // Keep a fixed angle between two straight lines that meet at a shared vertex.
  // When exactly one of the pair moved, rotate the other about the vertex to
  // restore the angle (preserving which side it's on).  Both-moved is treated
  // as a rigid translation, which already preserves the angle, so it's skipped.
  for (const c of constraints) {
    if (c.type !== "angle") continue;
    const target = typeof c.angle === "number" ? c.angle : parseFloat(c.angle);
    if (!Number.isFinite(target)) continue;
    const aUp = updated.has(c.shapeAIdx);
    const bUp = updated.has(c.shapeBIdx);
    if (aUp === bUp) continue;
    const fixedIdx = aUp ? c.shapeAIdx : c.shapeBIdx;
    const fixedKey = aUp ? c.pointA : c.pointB;
    const rotIdx = aUp ? c.shapeBIdx : c.shapeAIdx;
    const rotKey = aUp ? c.pointB : c.pointA;
    const fixedShape = shapes[fixedIdx];
    const rotShape = shapes[rotIdx];
    if (
      !fixedShape ||
      fixedShape.type !== "line" ||
      !rotShape ||
      rotShape.type !== "line"
    )
      continue;
    const P = getShapePoint(fixedShape, fixedKey); // shared vertex
    const fixedOther = getShapePoint(
      fixedShape,
      fixedKey === "start" ? "end" : "start",
    );
    const rotOtherKey = rotKey === "start" ? "end" : "start";
    const rotOther = getShapePoint(rotShape, rotOtherKey);
    if (!P || !fixedOther || !rotOther) continue;
    const dirF = { x: fixedOther.x - P.x, y: fixedOther.y - P.y };
    const dirR = { x: rotOther.x - P.x, y: rotOther.y - P.y };
    const lenF = Math.hypot(dirF.x, dirF.y);
    const lenR = Math.hypot(dirR.x, dirR.y);
    if (lenF < 1e-9 || lenR < 1e-9) continue;
    const dot = dirF.x * dirR.x + dirF.y * dirR.y;
    const cross = dirF.x * dirR.y - dirF.y * dirR.x;
    const signed = Math.atan2(cross, dot); // current signed angle F→R
    const tgt = (target * Math.PI) / 180;
    if (Math.abs(Math.abs(signed) - tgt) < 1e-6) continue;
    const targetSigned = tgt * (signed >= 0 ? 1 : -1);
    const fx = dirF.x / lenF,
      fy = dirF.y / lenF;
    const ca = Math.cos(targetSigned),
      sa = Math.sin(targetSigned);
    const ndx = fx * ca - fy * sa,
      ndy = fx * sa + fy * ca;
    const newOther = { x: P.x + ndx * lenR, y: P.y + ndy * lenR };
    let moved = moveShapePoint(rotShape, rotOtherKey, newOther);
    if (!moved) continue;
    moved = applyHVEnforcement(moved, rotOtherKey, constraints, rotIdx);
    shapes[rotIdx] = moved;
    updated.set(rotIdx, moved);
    propagateCoincidentFrom(rotIdx, shapes, updated, constraints);
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

  // ── Final coincident reconciliation ──────────────────────────────────────────
  // The main BFS places each endpoint once (placedEP), so a point coincident to
  // two shapes can be placed from one before the other has settled — e.g. a
  // rectangle-diagonal corner pinned to BOTH the vertical edge and the
  // horizontal edge: it follows the vertical edge's X but the horizontal edge's
  // later Y correction is then blocked, stranding it.  Sweep all coincidents to
  // a fixed point, moving the less-constrained side (the free follower) onto the
  // more-constrained one (an H/V- or distance-pinned edge), never the drag
  // anchors.  No-op when every coincident already holds.
  const rigidity = new Array(shapes.length).fill(0);
  for (const c of constraints) {
    if (c.type === "horizontal" || c.type === "vertical")
      rigidity[c.shapeIdx]++;
    else if (c.type === "distance" || c.type === "angle") {
      rigidity[c.shapeAIdx]++;
      if (c.shapeBIdx !== c.shapeAIdx) rigidity[c.shapeBIdx]++;
    }
  }
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const c of constraints) {
      if (c.type !== "coincident") continue;
      const sa = shapes[c.shapeAIdx];
      const sb = shapes[c.shapeBIdx];
      if (!sa || !sb) continue;
      const pa = getShapePoint(sa, c.pointA);
      const pb = getShapePoint(sb, c.pointB);
      if (!pa || !pb) continue;
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < 1e-7) continue;
      const aAnch = anchored.has(epKey(c.shapeAIdx, c.pointA));
      const bAnch = anchored.has(epKey(c.shapeBIdx, c.pointB));
      if (aAnch && bAnch) continue; // both fixed — can't reconcile
      // Move the less-constrained (or non-anchored) endpoint onto the other.
      let moveA;
      if (aAnch) moveA = false;
      else if (bAnch) moveA = true;
      else moveA = rigidity[c.shapeAIdx] <= rigidity[c.shapeBIdx];
      const tgtIdx = moveA ? c.shapeAIdx : c.shapeBIdx;
      const tgtKey = moveA ? c.pointA : c.pointB;
      const srcPos = moveA ? pb : pa;
      let moved = moveShapePoint(shapes[tgtIdx], tgtKey, srcPos);
      if (!moved) continue;
      moved = applyHVEnforcement(moved, tgtKey, constraints, tgtIdx);
      shapes[tgtIdx] = moved;
      updated.set(tgtIdx, moved);
      changed = true;
    }
    // onLine points (e.g. a circle centre constrained to the diagonal) are
    // re-projected here too: the standalone onLine pass above runs before the
    // distance passes settle the line's endpoints, so a point projected onto a
    // not-yet-final line drifts off it.  Re-projecting in this fixed-point loop
    // keeps it on the line once everything has settled.
    for (const c of constraints) {
      if (c.type !== "onLine") continue;
      const lineShape = shapes[c.lineShapeIdx];
      const ptShape = shapes[c.pointShapeIdx];
      if (!lineShape || lineShape.type !== "line" || !ptShape) continue;
      const cur = getShapePoint(ptShape, c.pointKey);
      if (!cur) continue;
      const proj = projectOntoLine(cur, lineShape);
      if (Math.hypot(proj.x - cur.x, proj.y - cur.y) < 1e-7) continue;
      let moved = moveShapePoint(ptShape, c.pointKey, proj);
      if (!moved) continue;
      moved = applyHVEnforcement(
        moved,
        c.pointKey,
        constraints,
        c.pointShapeIdx,
      );
      shapes[c.pointShapeIdx] = moved;
      updated.set(c.pointShapeIdx, moved);
      changed = true;
    }
    if (!changed) break;
  }

  return updated;
}
