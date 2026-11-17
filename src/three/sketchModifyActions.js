// Shared sketch "Modify" actions used by both the toolbar buttons
// (SketchModifySection) and the keyboard shortcuts (sketchInteraction's
// onKeyDown).  Pure store manipulation — no React — so the two entry points
// run identical behaviour.

import { useStore } from "../store";

// The line indices the modify actions operate on: the multi-selection if any,
// otherwise the single selected line.
export function selectedSketchLineIndices() {
  const store = useStore.getState();
  if (store.sketchMultiSelectedIndices.length > 0)
    return store.sketchMultiSelectedIndices;
  const sel = store.selectedSketchElement;
  return sel?.type === "line" ? [sel.shapeIdx] : [];
}

// Whether constraints hold two lines parallel, directly or through others: two
// lines each parallel to a third qualify, and so does a line parallel to one
// that shares an axis with the other.
export function linesShareDirection(constraints, a, b) {
  const reached = new Set([a]);
  const stack = [a];
  while (stack.length > 0) {
    const idx = stack.pop();
    const visit = (next) => {
      if (reached.has(next)) return;
      reached.add(next);
      stack.push(next);
    };
    for (const c of constraints) {
      if (c.type === "parallel" || c.type === "colinear") {
        if (c.shapeAIdx === idx) visit(c.shapeBIdx);
        if (c.shapeBIdx === idx) visit(c.shapeAIdx);
      } else if (
        (c.type === "horizontal" || c.type === "vertical") &&
        c.shapeIdx === idx
      ) {
        for (const o of constraints)
          if (o.type === c.type && o.shapeIdx != null) visit(o.shapeIdx);
      }
    }
  }
  return reached.has(b);
}

// Whether the distance tool takes two lines as a gap: null when not, else
// whether a parallel constraint must come with it.  Lines constraints hold
// parallel need none; lines drawn parallel within a degree (by eye, or snapped
// to the same angle) get one, so the dimension stays a gap rather than a
// point-to-line distance the other line can swing about.  A pair held at an
// angle or square is never made parallel.
const GAP_PARALLEL_SIN = Math.sin((1 * Math.PI) / 180);
export function parallelGap(shapes, constraints, a, b) {
  if (linesShareDirection(constraints, a, b)) return { holdParallel: false };
  const held = constraints.some(
    (c) =>
      (c.type === "angleDimension" || c.type === "perpendicular") &&
      ((c.shapeAIdx === a && c.shapeBIdx === b) ||
        (c.shapeAIdx === b && c.shapeBIdx === a)),
  );
  if (held) return null;
  const s = shapes[a];
  const t = shapes[b];
  const ux = s.x2 - s.x1,
    uy = s.y2 - s.y1;
  const vx = t.x2 - t.x1,
    vy = t.y2 - t.y1;
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!(n > 0)) return null;
  return Math.abs(ux * vy - uy * vx) / n <= GAP_PARALLEL_SIN
    ? { holdParallel: true }
    : null;
}

// The distance input for the gap between two parallel lines.  It is measured
// from the first, which is the one that moves first.  `holdParallel` asks the
// commit to add a parallel constraint with it (see parallelGap).
export function lineGapInput(shapes, firstIdx, otherIdx, holdParallel = false) {
  const from = shapes[firstIdx];
  const to = shapes[otherIdx];
  const dx = to.x2 - to.x1;
  const dy = to.y2 - to.y1;
  const len = Math.hypot(dx, dy) || 1e-9;
  return {
    pointLine: {
      pointShapeIdx: firstIdx,
      pointKey: "start",
      lineShapeIdx: otherIdx,
    },
    defaultDistance: Math.abs(
      ((from.x1 - to.x1) * dy - (from.y1 - to.y1) * dx) / len,
    ),
    ...(holdParallel ? { holdParallel: true } : {}),
  };
}

// Starting the distance tool with two parallel lines selected goes straight to
// the gap between them, as the other constraint tools act on the selection.
// False when the selection isn't such a pair, which leaves the tool picking.
export function openGapDistanceFromSelection() {
  const store = useStore.getState();
  const picks = store.sketchMultiSelectedIndices;
  if (picks.length !== 2) return false;
  const item = store.items.find((i) => i.id === store.selectedId);
  const constraints = item?.constraints || [];
  const [a, b] = picks;
  if (item?.shapes[a]?.type !== "line" || item.shapes[b]?.type !== "line")
    return false;
  // A dimension on an offset copy would fight the offset that places it.
  const isCopy = (i) =>
    constraints.some((c) => c.type === "offset" && c.shapeIdx === i);
  const gap = parallelGap(item.shapes, constraints, a, b);
  if (isCopy(a) || isCopy(b) || !gap) return false;
  store.setSketchDistanceInput(
    lineGapInput(item.shapes, a, b, gap.holdParallel),
  );
  return true;
}

// Offset the selected lines (Shift / `negative` flips to the other side), then
// open the distance editor seeded with the new offset constraint so the user
// is prompted for the real distance — window.prompt isn't usable in Electron.
export function offsetSelectedSketchGeometry(selectedId, indices, negative) {
  if (!indices || indices.length === 0) return;
  const store = useStore.getState();
  store.offsetSketchGeometry(selectedId, indices, negative ? "-5" : "5");

  const item = useStore.getState().items.find((i) => i.id === selectedId);
  const constraints = item?.constraints || [];
  let lastIdx = -1;
  let lastGroup = -1;
  constraints.forEach((c, i) => {
    if (c.type === "offset" && (c.offsetGroup ?? 0) >= lastGroup) {
      lastGroup = c.offsetGroup ?? 0;
      lastIdx = i;
    }
  });
  if (lastIdx >= 0) {
    store.setSketchDistanceInput({
      offsetConstraintIdx: lastIdx,
      offsetGroup: constraints[lastIdx].offsetGroup,
      defaultDistance: constraints[lastIdx].distance,
      // Freshly created this entry — Cancel discards the whole offset.  Editing
      // an existing offset (double-click) sets no flag, so Cancel restores the
      // prior distance instead of deleting the user's offset.
      created: true,
    });
    store.setSketchConstraintMode("distance");
  }
}
