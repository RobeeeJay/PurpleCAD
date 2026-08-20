// Sketch Offset tool: parallel-copy geometry (offsetSketchGeometry) and the
// live edit of an existing offset's distance (updateSketchOffsetDistance /
// previewSketchOffsetDistance), plus the pure offset-geometry helpers they use.
// Beziers can't be solver variables, so their offset copies are recomputed
// geometrically from the pinned original (recomputeBezierOffsets) after each
// re-solve.  Split out of sketchSlice.js and composed back via spread.

import {
  pushSketchSnapshot,
  withOrphanFlags,
  saveTimeline,
  markCsgDirty,
} from "./internals.js";
import { solveConstraints, varFields } from "../three/sketchSolver.js";
import { resolveValue } from "../three/geometryParams.js";

// Shape types the Offset tool can copy.
export const OFFSETTABLE_TYPES = ["line", "circle", "arc", "ellipse", "bezier"];

// Approximate parallel offset of a cubic bezier: shift each control point along
// the curve normal at its parameter (endpoints exact, interior approximate).
// A true offset of a bezier isn't a bezier, so this is the usual CAD
// approximation — good for the gentle curves sketches use.
const offsetBezierGeometry = (o, d) => {
  const { p0, p1, p2, p3 } = o;
  const deriv = (t) => {
    const mt = 1 - t;
    return {
      x:
        3 * mt * mt * (p1.x - p0.x) +
        6 * mt * t * (p2.x - p1.x) +
        3 * t * t * (p3.x - p2.x),
      y:
        3 * mt * mt * (p1.y - p0.y) +
        6 * mt * t * (p2.y - p1.y) +
        3 * t * t * (p3.y - p2.y),
    };
  };
  const off = (pt, t) => {
    const tg = deriv(t);
    let len = Math.hypot(tg.x, tg.y);
    if (len < 1e-9) {
      // Degenerate tangent (coincident control points) → use the chord.
      const cx = p3.x - p0.x,
        cy = p3.y - p0.y;
      len = Math.hypot(cx, cy) || 1e-9;
      return { x: pt.x + (d * cy) / len, y: pt.y + (d * -cx) / len };
    }
    // Right normal, matching the line-offset convention.
    return { x: pt.x + (d * tg.y) / len, y: pt.y + (d * -tg.x) / len };
  };
  return {
    type: "bezier",
    p0: off(p0, 0),
    p1: off(p1, 1 / 3),
    p2: off(p2, 2 / 3),
    p3: off(p3, 1),
    ...(o.dashed ? { dashed: true } : null),
  };
};

// Geometric offset of a sketch shape by a signed scene distance (right-normal
// = +d side, matching the line convention; circles/arcs/ellipses grow their
// radii by +d).  Returns null for types that can't be offset.
export const offsetShapeGeometry = (o, d) => {
  const dashed = o.dashed ? { dashed: true } : null;
  switch (o.type) {
    case "line": {
      const odx = o.x2 - o.x1,
        ody = o.y2 - o.y1;
      const len = Math.hypot(odx, ody) || 1e-9;
      const nx = ody / len,
        ny = -odx / len;
      return {
        type: "line",
        x1: o.x1 + d * nx,
        y1: o.y1 + d * ny,
        x2: o.x2 + d * nx,
        y2: o.y2 + d * ny,
        ...dashed,
      };
    }
    case "circle":
      return {
        type: "circle",
        cx: o.cx,
        cy: o.cy,
        r: Math.max(1e-4, (o.r ?? 0) + d),
        ...dashed,
      };
    case "arc":
      return {
        type: "arc",
        cx: o.cx,
        cy: o.cy,
        r: Math.max(1e-4, (o.r ?? 0) + d),
        startAngle: o.startAngle,
        endAngle: o.endAngle,
        ...dashed,
      };
    case "ellipse":
      return {
        type: "ellipse",
        cx: o.cx,
        cy: o.cy,
        rx: Math.max(1e-4, (o.rx ?? 0) + d),
        ry: Math.max(1e-4, (o.ry ?? 0) + d),
        rotation: o.rotation || 0,
        ...dashed,
      };
    case "bezier":
      return offsetBezierGeometry(o, d);
    default:
      return null;
  }
};

// Beziers aren't solver variables, so re-solving can't move their offset
// copies — recompute them geometrically from the (pinned) original at the
// constraint's current distance.  Returns the same array ref when unchanged.
const recomputeBezierOffsets = (shapes, constraints) => {
  let out = shapes;
  constraints.forEach((c) => {
    if (c.type !== "offset") return;
    const orig = out[c.origIdx];
    const tgt = out[c.shapeIdx];
    if (orig?.type !== "bezier" || tgt?.type !== "bezier") return;
    const d = resolveValue(c.distance, 0);
    if (!Number.isFinite(d)) return;
    if (out === shapes) out = shapes.slice();
    out[c.shapeIdx] = offsetShapeGeometry(orig, d);
  });
  return out;
};

export const createSketchOffsetSlice = (set) => ({
  // Offset the selected lines: create parallel copies at a signed distance,
  // each linked to its original by an `offset` constraint (so edits to the
  // original flow through the solver to the copy), with coincident constraints
  // where the originals shared a corner.  `distance` is an mm formula; its
  // sign picks the side.
  offsetSketchGeometry: (sketchId, lineIndices, distance) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      const shapes = item.shapes || [];
      const sel = (lineIndices || []).filter((idx) =>
        OFFSETTABLE_TYPES.includes(shapes[idx]?.type),
      );
      if (sel.length === 0) return {};
      const dScene = resolveValue(distance, 0.5);
      if (!Number.isFinite(dScene) || dScene === 0) return {};

      // One group id for this whole offset so editing its dimension changes
      // every copy together.
      const offsetGroup =
        1 +
        (item.constraints || []).reduce(
          (m, c) => (c.type === "offset" ? Math.max(m, c.offsetGroup ?? 0) : m),
          0,
        );

      const base = shapes.length;
      const newShapes = [];
      const newConstraints = [];
      const newIdxOf = new Map();
      sel.forEach((origIdx) => {
        const copy = offsetShapeGeometry(shapes[origIdx], dScene);
        if (!copy) return;
        const newIdx = base + newShapes.length;
        newIdxOf.set(origIdx, newIdx);
        newShapes.push(copy);
        newConstraints.push({
          type: "offset",
          shapeIdx: newIdx,
          origIdx,
          distance,
          offsetGroup,
        });
      });

      // Chamfer / fillet corners need their offset SIDE corrected.  Every other
      // edge of a closed loop offsets to a consistent side via its own
      // right-normal because the loop is consistently wound, but a chamfer
      // line / bevel arc bridge is built from the junction's (arbitrary) a/b
      // order, so its own normal can point the opposite way.  Then the
      // perpendicular-offset residual drives it to the wrong side while the
      // corner coincidents pull it to the legs — it stretches into a huge wedge
      // off the corner.  Decide the correct side here (where the legs are) and
      // record `sideSign` on the bridge's offset constraint so the solver and
      // later distance edits keep it.  A bevel additionally needs coincidents
      // tying its arc ends to the legs (the corner chaining below only links
      // lines, so the arc would otherwise float and the re-solve under-determine);
      // a chamfer's line bridge is already chained.
      const rightNormal = (s) => {
        const dx = s.x2 - s.x1,
          dy = s.y2 - s.y1;
        const l = Math.hypot(dx, dy) || 1e-9;
        return { x: dy / l, y: -dx / l };
      };
      // Intersection of two infinite lines (each given as a segment), or null.
      const lineLineIntersect = (p, q) => {
        const r1x = p.x2 - p.x1,
          r1y = p.y2 - p.y1;
        const r2x = q.x2 - q.x1,
          r2y = q.y2 - q.y1;
        const den = r1x * r2y - r1y * r2x;
        if (Math.abs(den) < 1e-12) return null;
        const t = ((q.x1 - p.x1) * r2y - (q.y1 - p.y1) * r2x) / den;
        return { x: p.x1 + t * r1x, y: p.y1 + t * r1y };
      };
      sel.forEach((origIdx) => {
        const o = shapes[origIdx];
        const data = o?.chamferData || o?.bevelData;
        if ((o?.kind !== "chamfer" && o?.kind !== "bevel") || !data) return;
        const { aIdx, aKey, bIdx, bKey } = data;
        if (!newIdxOf.has(aIdx) || !newIdxOf.has(bIdx)) return;
        const copyIdx = newIdxOf.get(origIdx);
        const oc = newConstraints.find(
          (c) => c.type === "offset" && c.origIdx === origIdx,
        );

        if (o.kind === "bevel" && o.type === "arc") {
          // Concentric arc: its radius is the original centre's perpendicular
          // distance to the offset leg, so the sign follows from rNew vs r.
          const legA = newShapes[newIdxOf.get(aIdx) - base];
          const lx = legA.x2 - legA.x1,
            ly = legA.y2 - legA.y1;
          const len = Math.hypot(lx, ly) || 1e-9;
          const rNew = Math.abs(
            ((o.cx - legA.x1) * ly - (o.cy - legA.y1) * lx) / len,
          );
          const sideSign = rNew - o.r >= 0 === dScene >= 0 ? 1 : -1;
          newShapes[copyIdx - base].r = Math.max(1e-4, rNew);
          if (oc) oc.sideSign = sideSign;
          newConstraints.push(
            {
              type: "coincident",
              shapeAIdx: copyIdx,
              pointA: "start",
              shapeBIdx: newIdxOf.get(aIdx),
              pointB: aKey,
            },
            {
              type: "coincident",
              shapeAIdx: copyIdx,
              pointA: "end",
              shapeBIdx: newIdxOf.get(bIdx),
              pointB: bKey,
            },
          );
        } else if (o.type === "line") {
          // Chamfer line.  A tool-built chamfer's bridge is wound opposite the
          // loop, so a plain +d offset throws it to the far side (the wedge).
          // Record sideSign so the offset residual sides it correctly, and seed
          // the copy at the true parallel offset — the chamfer line shifted to
          // the legs' side, clipped to where it crosses the two offset legs — so
          // the solver starts at the answer and converges (a bare translation can
          // fail, leaving every edge merely shifted with nothing rejoined).  The
          // bridge keeps its offset constraint so the distance editor moves it.
          const nC = rightNormal(o);
          const nA = rightNormal(shapes[aIdx]);
          const sideSign = nC.x * nA.x + nC.y * nA.y >= 0 ? 1 : -1;
          if (oc) oc.sideSign = sideSign;
          const chamOff = offsetShapeGeometry(o, dScene * sideSign);
          const legACopy = newShapes[newIdxOf.get(aIdx) - base];
          const legBCopy = newShapes[newIdxOf.get(bIdx) - base];
          const s = lineLineIntersect(chamOff, legACopy);
          const e = lineLineIntersect(chamOff, legBCopy);
          if (s && e)
            newShapes[copyIdx - base] = {
              type: "line",
              x1: s.x,
              y1: s.y,
              x2: e.x,
              y2: e.y,
            };
          else newShapes[copyIdx - base] = chamOff;
        }
      });

      // Carry shared corners over to the copies: group the originals' endpoints
      // by position and chain a coincident between the matching new endpoints.
      const EPS = 1e-4;
      const key = (x, y) => `${Math.round(x / EPS)},${Math.round(y / EPS)}`;
      const groups = new Map();
      sel.forEach((origIdx) => {
        const o = shapes[origIdx];
        if (o.type !== "line") return; // circles share no corners
        [
          ["start", o.x1, o.y1],
          ["end", o.x2, o.y2],
        ].forEach(([pk, x, y]) => {
          const k = key(x, y);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push({ origIdx, pk });
        });
      });
      groups.forEach((grp) => {
        for (let i = 1; i < grp.length; i++) {
          const a = grp[0];
          const b = grp[i];
          if (a.origIdx === b.origIdx) continue;
          newConstraints.push({
            type: "coincident",
            shapeAIdx: newIdxOf.get(a.origIdx),
            pointA: a.pk,
            shapeBIdx: newIdxOf.get(b.origIdx),
            pointB: b.pk,
          });
        }
      });

      const allShapes = [...shapes, ...newShapes];
      const allConstraints = [...(item.constraints || []), ...newConstraints];
      // Pin every existing shape so ONLY the new copies move — the offset is
      // measured relative to the originals, so without this the solver could
      // satisfy it by nudging the originals instead.
      const fixed = new Set();
      for (let i = 0; i < base; i++)
        for (const f of varFields(shapes[i])) fixed.add(`${i}:${f}`);
      // Solve so the offset corners meet (line lengths adjust to the new
      // intersections); keep the raw placement if it can't converge.
      const { shapes: solved, ok } = solveConstraints(
        allShapes,
        allConstraints,
        {
          fixed,
        },
      );
      const finalShapes = ok ? solved : allShapes;

      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((it) =>
        it.id === sketchId
          ? Object.assign({}, it, {
              shapes: finalShapes,
              constraints: allConstraints,
            })
          : it,
      );
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (
          entry.instruction?.type === "create" &&
          entry.instruction.item?.id === sketchId
        ) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                shapes: updatedItem?.shapes,
                constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  // Change the offset distance (whole group, or one constraint) and re-solve so
  // only the offset copies move.  `formula` is a signed mm string.
  updateSketchOffsetDistance: (sketchId, offsetGroup, constraintIdx, formula) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      const constraints = (item.constraints || []).map((c, i) => {
        if (c.type !== "offset") return c;
        const inGroup =
          offsetGroup != null
            ? c.offsetGroup === offsetGroup
            : i === constraintIdx;
        return inGroup ? { ...c, distance: formula } : c;
      });
      const offsetTargets = new Set(
        constraints.filter((c) => c.type === "offset").map((c) => c.shapeIdx),
      );
      const fixed = new Set();
      (item.shapes || []).forEach((s, i) => {
        if (offsetTargets.has(i)) return;
        for (const f of varFields(s)) fixed.add(`${i}:${f}`);
      });
      const { shapes: solved, ok } = solveConstraints(
        item.shapes,
        constraints,
        {
          fixed,
        },
      );
      const finalShapes = recomputeBezierOffsets(
        ok ? solved : item.shapes,
        constraints,
      );

      pushSketchSnapshot(state, sketchId);
      const updatedItems = state.items.map((it) =>
        it.id === sketchId
          ? Object.assign({}, it, { shapes: finalShapes, constraints })
          : it,
      );
      const updatedItem = updatedItems.find((i) => i.id === sketchId);
      const newHistory = state.history.map((entry) => {
        if (
          entry.instruction?.type === "create" &&
          entry.instruction.item?.id === sketchId
        ) {
          return Object.assign({}, entry, {
            instruction: Object.assign({}, entry.instruction, {
              item: Object.assign({}, entry.instruction.item, {
                shapes: updatedItem?.shapes,
                constraints: updatedItem?.constraints,
              }),
            }),
          });
        }
        return entry;
      });
      saveTimeline(newHistory, state.activeHistoryId);
      return {
        items: markCsgDirty(updatedItems),
        history: withOrphanFlags(newHistory),
      };
    }),

  // Live preview of an offset-distance edit: re-solve and update ONLY the live
  // items (geometry + the shown constraint value) — no snapshot, history, or CSG
  // dirtying.  Enter commits via updateSketchOffsetDistance; Escape restores by
  // previewing the original value.
  previewSketchOffsetDistance: (
    sketchId,
    offsetGroup,
    constraintIdx,
    formula,
  ) =>
    set((state) => {
      const item = state.items.find((i) => i.id === sketchId);
      if (!item) return {};
      const constraints = (item.constraints || []).map((c, i) => {
        if (c.type !== "offset") return c;
        const inGroup =
          offsetGroup != null
            ? c.offsetGroup === offsetGroup
            : i === constraintIdx;
        return inGroup ? { ...c, distance: formula } : c;
      });
      const offsetTargets = new Set(
        constraints.filter((c) => c.type === "offset").map((c) => c.shapeIdx),
      );
      const fixed = new Set();
      (item.shapes || []).forEach((s, i) => {
        if (offsetTargets.has(i)) return;
        for (const f of varFields(s)) fixed.add(`${i}:${f}`);
      });
      const { shapes: solved, ok } = solveConstraints(
        item.shapes,
        constraints,
        {
          fixed,
        },
      );
      const finalShapes = recomputeBezierOffsets(
        ok ? solved : item.shapes,
        constraints,
      );
      return {
        items: state.items.map((it) =>
          it.id === sketchId
            ? Object.assign({}, it, {
                shapes: finalShapes,
                constraints,
              })
            : it,
        ),
      };
    }),
});
