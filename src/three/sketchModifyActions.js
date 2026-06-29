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
