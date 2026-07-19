import { getShapePoint, moveShapePoint } from "./sceneObjects.js";
import { shapeMidpoint, sharpLineExtra } from "./sketchGeometry.js";
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
    // Sharp semantics: the target names the virtual-corner length, so the
    // trimmed endpoints sit `setbacks` closer together.
    const effTarget = target - sharpLineExtra(shapes, c);
    if (!(effTarget > 0)) continue;
    const dx = pB.x - pA.x,
      dy = pB.y - pA.y;
    const cur = Math.hypot(dx, dy);
    if (cur < 1e-10) continue;
    if (Math.abs(cur - effTarget) < tol) continue;
    const newPt = {
      x: pA.x + (dx / cur) * effTarget,
      y: pA.y + (dy / cur) * effTarget,
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

// True only if EVERY constraint holds in `shapes` (within tolerance).  Used to
// validate a proposed transformation: resolve the constraints, then check the
// result — if any constraint is broken the caller rejects the change rather
// than committing distorted geometry.
export function allConstraintsSatisfied(shapes, constraints, variables = null) {
  const POS_TOL = 1e-3; // scene units
  const ANG_TOL = 0.05 * (Math.PI / 180); // radians (~0.05°)
  for (const c of constraints || []) {
    if (c.type === "coincident") {
      const a = getShapePoint(shapes[c.shapeAIdx], c.pointA);
      const b = getShapePoint(shapes[c.shapeBIdx], c.pointB);
      if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) > POS_TOL) return false;
    } else if (c.type === "distance") {
      const target = resolveConstraintDistance(c, variables);
      if (!(target > 0)) continue;
      const a = getShapePoint(shapes[c.shapeAIdx], c.pointA);
      const b = getShapePoint(shapes[c.shapeBIdx], c.pointB);
      if (!a || !b) return false;
      const meas = Math.hypot(a.x - b.x, a.y - b.y) + sharpLineExtra(shapes, c);
      if (Math.abs(meas - target) > POS_TOL) return false;
    } else if (c.type === "horizontal") {
      const s = shapes[c.shapeIdx];
      if (!s || s.type !== "line" || Math.abs(s.y1 - s.y2) > POS_TOL)
        return false;
    } else if (c.type === "vertical") {
      const s = shapes[c.shapeIdx];
      if (!s || s.type !== "line" || Math.abs(s.x1 - s.x2) > POS_TOL)
        return false;
    } else if (c.type === "onLine") {
      const line = shapes[c.lineShapeIdx];
      const p = getShapePoint(shapes[c.pointShapeIdx], c.pointKey);
      if (!line || line.type !== "line" || !p) return false;
      const dx = line.x2 - line.x1,
        dy = line.y2 - line.y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return false;
      // Perpendicular distance to the infinite line.
      const d = Math.abs((p.x - line.x1) * dy - (p.y - line.y1) * dx) / len;
      if (d > POS_TOL) return false;
    } else if (c.type === "pointLineDistance") {
      const target = resolveConstraintDistance(c, variables);
      if (!(target > 0)) continue;
      const line = shapes[c.lineShapeIdx];
      const p = getShapePoint(shapes[c.pointShapeIdx], c.pointKey ?? "point");
      if (!line || line.type !== "line" || !p) return false;
      const dx = line.x2 - line.x1,
        dy = line.y2 - line.y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return false;
      const d = Math.abs((p.x - line.x1) * dy - (p.y - line.y1) * dx) / len;
      if (Math.abs(d - target) > POS_TOL) return false;
    } else if (c.type === "midpoint") {
      const p = getShapePoint(shapes[c.pointShapeIdx], c.pointKey ?? "point");
      const m = shapeMidpoint(shapes[c.targetShapeIdx]);
      if (!p || !m || Math.hypot(p.x - m.x, p.y - m.y) > POS_TOL) return false;
    } else if (c.type === "angle") {
      const target =
        typeof c.angle === "number" ? c.angle : parseFloat(c.angle);
      if (!Number.isFinite(target)) continue;
      const sA = shapes[c.shapeAIdx],
        sB = shapes[c.shapeBIdx];
      if (!sA || sA.type !== "line" || !sB || sB.type !== "line") return false;
      const P = getShapePoint(sA, c.pointA);
      const oA = getShapePoint(sA, c.pointA === "start" ? "end" : "start");
      const oB = getShapePoint(sB, c.pointB === "start" ? "end" : "start");
      if (!P || !oA || !oB) return false;
      const fa = Math.atan2(oA.y - P.y, oA.x - P.x);
      const fb = Math.atan2(oB.y - P.y, oB.x - P.x);
      let d = Math.abs(fb - fa);
      while (d > Math.PI) d = Math.abs(d - 2 * Math.PI);
      if (Math.abs(d - (target * Math.PI) / 180) > ANG_TOL) return false;
    }
  }
  return true;
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
  shapeMidpoint,
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
  // Respect the primary shape's own H/V constraint.  An explicitly-placed
  // endpoint (e.g. the corner moved to satisfy a distance constraint) can tilt
  // an H/V-constrained edge; re-level it here, keeping that endpoint fixed, so
  // the line stays horizontal/vertical and the freed endpoint propagates
  // through the coincident BFS below.  The drag path already pre-levels, so
  // this is idempotent there.
  if (primaryPointKey) {
    primaryShape = applyHVEnforcement(
      primaryShape,
      primaryPointKey,
      constraints,
      primaryIdx,
    );
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

  // Endpoints a same-shape (line-length) distance constraint pins: moving them
  // would change a locked length.  Include their coincident partners so a
  // corner shared with a length-locked side (e.g. a diagonal's end) counts too.
  // A point-to-point distance then prefers to move its OTHER, un-pinned end —
  // so dragging a circle pinned to such a corner slides the circle, not the
  // rigid square it's anchored to.
  const lengthPinned = new Set();
  for (const c of constraints) {
    // Only a LINE's length pins its endpoints.  A circle's same-shape distance
    // is its radius (centre↔edge) — moving the centre carries the edge along, so
    // the centre is free, not pinned.  Treating it as pinned wrongly froze the
    // circle and made its centre↔corner distance unsolvable.
    if (
      c.type === "distance" &&
      c.shapeAIdx === c.shapeBIdx &&
      shapes[c.shapeAIdx]?.type === "line"
    ) {
      lengthPinned.add(epKey(c.shapeAIdx, c.pointA));
      lengthPinned.add(epKey(c.shapeBIdx, c.pointB));
    }
  }
  let grewPinned = true;
  while (grewPinned) {
    grewPinned = false;
    for (const c of constraints) {
      if (c.type !== "coincident") continue;
      const aK = epKey(c.shapeAIdx, c.pointA);
      const bK = epKey(c.shapeBIdx, c.pointB);
      if (lengthPinned.has(aK) !== lengthPinned.has(bK)) {
        lengthPinned.add(aK);
        lengthPinned.add(bK);
        grewPinned = true;
      }
    }
  }

  // Points constrained to slide along a line.  In a point-to-point distance the
  // slider is the flexible side, so it yields (moves) while a rigid corner on
  // the other end stays put — even when only H/V (not a length) pins that
  // corner, which lengthPinned alone can't see.
  const onLinePts = new Set();
  for (const c of constraints) {
    if (c.type === "onLine") onLinePts.add(epKey(c.pointShapeIdx, c.pointKey));
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
        // Default: move the side that wasn't the source of movement.  Prefer to
        // move an onLine slider (it yields along its line); failing that, never
        // move a length-pinned endpoint when the other side is free — otherwise
        // the drag deforms the rigid body the constraint is anchored to.
        const aEP = epKey(ai, pA),
          bEP = epKey(bi, pB);
        const aSlider = onLinePts.has(aEP),
          bSlider = onLinePts.has(bEP);
        let moveB = aUp;
        if (aSlider !== bSlider) {
          moveB = bSlider;
        } else if (moveB && lengthPinned.has(bEP) && !lengthPinned.has(aEP)) {
          moveB = false;
        } else if (!moveB && lengthPinned.has(aEP) && !lengthPinned.has(bEP)) {
          moveB = true;
        }
        let targetIdx, targetKey, newX, newY;
        if (moveB) {
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

  // ── Corner (bevel arc / chamfer line) recomputation ──────────────────────────
  // Both hold their shape by re-deriving from their two legs whenever a leg moves
  // (directly or via a dragged connected line), rather than by fragile angle locks.
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    const corner =
      shape?.kind === "bevel"
        ? shape.bevelData
        : shape?.kind === "chamfer"
          ? shape.chamferData
          : null;
    if (!corner) continue;
    const { aIdx, aKey, bIdx, bKey, dist: bDist } = corner;
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
    let rebuilt;
    if (shape.kind === "bevel") {
      const newArc = buildBevelArc(P, uA, uB, newTrimA, newTrimB);
      if (!newArc) continue;
      newArc.kind = "bevel";
      newArc.bevelData = corner;
      rebuilt = newArc;
    } else {
      rebuilt = {
        type: "line",
        x1: newTrimA.x,
        y1: newTrimA.y,
        x2: newTrimB.x,
        y2: newTrimB.y,
        kind: "chamfer",
        chamferData: corner,
      };
    }
    shapes[i] = rebuilt;
    updated.set(i, rebuilt);
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
  // An endpoint coincident (transitively) to a drag anchor is itself pinned —
  // e.g. the diagonal's corner that shares the dragged square corner.  Treat
  // those as fixed so a distance constraint slides the OTHER (free) endpoint,
  // rather than the distance pass bailing because both sides look "moved".
  const effAnchored = new Set(anchored);
  let grewAnchor = true;
  while (grewAnchor) {
    grewAnchor = false;
    for (const c of constraints) {
      if (c.type !== "coincident") continue;
      const aK = epKey(c.shapeAIdx, c.pointA);
      const bK = epKey(c.shapeBIdx, c.pointB);
      if (effAnchored.has(aK) !== effAnchored.has(bK)) {
        effAnchored.add(aK);
        effAnchored.add(bK);
        grewAnchor = true;
      }
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
    // Re-assert two-shape distances after coincident/onLine settle.  The main
    // distance passes skip when both endpoints look moved (here the diagonal
    // corner moved via coincident and the onLine circle via projection), so a
    // circle pinned to the line + a fixed distance from the corner is left at
    // the wrong distance.  Keep the (effectively) anchored side, slide the
    // other along the current direction — which, after onLine projection, runs
    // along the line, so the freed point lands on the line at the right gap.
    for (const c of constraints) {
      if (c.type !== "distance" || c.shapeAIdx === c.shapeBIdx) continue;
      const d = resolveConstraintDistance(c);
      if (!(d > 0)) continue;
      const sA = shapes[c.shapeAIdx],
        sB = shapes[c.shapeBIdx];
      if (!sA || !sB) continue;
      const pa = getShapePoint(sA, c.pointA),
        pb = getShapePoint(sB, c.pointB);
      if (!pa || !pb) continue;
      const cur = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      // Don't bail on cur≈0 here: a point clamped onto its anchor (onLine
      // projection lands past the segment end) still needs repositioning, and
      // the line-direction branch below supplies a usable direction.
      if (Math.abs(cur - d) < 1e-7) continue;
      // A side is "fixed" if it's a drag anchor (or coincident to one) or a
      // length-pinned corner — moving it would break a locked length.  Without
      // the lengthPinned guard a rigidity tie defaults to dragging the diagonal
      // corner, so dragging the far corner lurched the circle toward it before a
      // second drag settled it.
      const aEP = epKey(c.shapeAIdx, c.pointA);
      const bEP = epKey(c.shapeBIdx, c.pointB);
      const aSlider = onLinePts.has(aEP);
      const bSlider = onLinePts.has(bEP);
      let moveB;
      if (aSlider !== bSlider) {
        // Exactly one side slides along a line: move it, hold the rigid side.
        moveB = bSlider;
      } else {
        const aFixed = effAnchored.has(aEP) || lengthPinned.has(aEP);
        const bFixed = effAnchored.has(bEP) || lengthPinned.has(bEP);
        if (aFixed && bFixed) continue;
        if (aFixed) moveB = true;
        else if (bFixed) moveB = false;
        else moveB = rigidity[c.shapeBIdx] <= rigidity[c.shapeAIdx];
      }
      const anchorPos = moveB ? pa : pb;
      const movingPos = moveB ? pb : pa;
      const tgtIdx = moveB ? c.shapeBIdx : c.shapeAIdx;
      const tgtKey = moveB ? c.pointB : c.pointA;
      // Direction from the anchor to where the moving point should sit.  When
      // the moving point is onLine a line whose endpoint IS the anchor, take the
      // line's direction toward its far end instead of the current offset: a big
      // rotation can project the point past the anchor, and the offset-derived
      // direction would then flip it to the wrong side (the "jumps to the far
      // corner" symptom).  The line direction is unambiguous.
      let dirX = movingPos.x - anchorPos.x,
        dirY = movingPos.y - anchorPos.y;
      const onLineC = constraints.find(
        (oc) =>
          oc.type === "onLine" &&
          oc.pointShapeIdx === tgtIdx &&
          oc.pointKey === tgtKey,
      );
      if (onLineC) {
        const ln = shapes[onLineC.lineShapeIdx];
        if (ln && ln.type === "line") {
          const ls = getShapePoint(ln, "start");
          const le = getShapePoint(ln, "end");
          const far =
            Math.hypot(ls.x - anchorPos.x, ls.y - anchorPos.y) < 1e-6
              ? le
              : Math.hypot(le.x - anchorPos.x, le.y - anchorPos.y) < 1e-6
                ? ls
                : null;
          if (far) {
            dirX = far.x - anchorPos.x;
            dirY = far.y - anchorPos.y;
          }
        }
      }
      const dlen = Math.hypot(dirX, dirY);
      if (dlen < 1e-10) continue;
      const newPos = {
        x: anchorPos.x + (dirX / dlen) * d,
        y: anchorPos.y + (dirY / dlen) * d,
      };
      let moved = moveShapePoint(shapes[tgtIdx], tgtKey, newPos);
      if (!moved) continue;
      moved = applyHVEnforcement(moved, tgtKey, constraints, tgtIdx);
      shapes[tgtIdx] = moved;
      updated.set(tgtIdx, moved);
      propagateCoincidentFrom(tgtIdx, shapes, updated, constraints);
      changed = true;
    }
    if (!changed) break;
  }

  // Point-line dimensions hold during the fast drag path: the point slides
  // along the line's normal (same side preserved) to stay at the set
  // distance when either end of the relationship moves.
  for (const c of constraints) {
    if (c.type !== "pointLineDistance") continue;
    const target = resolveConstraintDistance(c);
    if (!(target > 0)) continue;
    const ln = updated.get(c.lineShapeIdx) ?? shapes[c.lineShapeIdx];
    const ptShape = updated.get(c.pointShapeIdx) ?? shapes[c.pointShapeIdx];
    if (!ln || ln.type !== "line" || !ptShape) continue;
    const p = getShapePoint(ptShape, c.pointKey ?? "point");
    if (!p) continue;
    const dx = ln.x2 - ln.x1,
      dy = ln.y2 - ln.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const signed = ((p.x - ln.x1) * dy - (p.y - ln.y1) * dx) / len;
    if (Math.abs(Math.abs(signed) - target) <= 1e-9) continue;
    const side = signed >= 0 ? 1 : -1;
    const nx = dy / len,
      ny = -dx / len; // normal with positive signed distance
    const goal = {
      x: p.x + nx * (side * target - signed),
      y: p.y + ny * (side * target - signed),
    };
    updated.set(
      c.pointShapeIdx,
      ptShape.type === "point"
        ? { ...ptShape, x: goal.x, y: goal.y }
        : moveShapePoint(ptShape, c.pointKey, goal),
    );
  }

  // Midpoint-constrained points ride their target's middle during the fast
  // drag path too (the numeric solver covers the commit; this keeps the live
  // preview honest when the target line/arc moved in this pass).
  for (const c of constraints) {
    if (c.type !== "midpoint") continue;
    const target = updated.get(c.targetShapeIdx) ?? shapes[c.targetShapeIdx];
    const m = shapeMidpoint(target);
    const pt = updated.get(c.pointShapeIdx) ?? shapes[c.pointShapeIdx];
    if (!m || !pt) continue;
    const cur = getShapePoint(pt, c.pointKey ?? "point");
    if (!cur || Math.hypot(cur.x - m.x, cur.y - m.y) <= 1e-9) continue;
    updated.set(
      c.pointShapeIdx,
      pt.type === "point"
        ? { ...pt, x: m.x, y: m.y }
        : moveShapePoint(pt, c.pointKey, m),
    );
  }
  return updated;
}
