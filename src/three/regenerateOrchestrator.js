// UI-side orchestrator for re-running CSG/chamfer regenerators after a
// curve-resolution or variables change.
//
// Why this lives outside the store: the store is in the worker's
// transitive import graph (via sceneObjects → store), and Vite's
// `inlineDynamicImports` for module workers follows dynamic imports
// inside that graph too.  If the store dynamic-imported regenerateItems,
// and regenerateItems imported occClient, the worker bundle would end up
// trying to bundle itself (occClient dynamic-imports the worker).
//
// Moving the orchestration here — imported only by Viewport, which the
// worker bundle never reaches — breaks the chain and lets regen go
// through the worker like the live BevelSection / CombineSection flows.

import { useStore } from "../store";
import { regenerateItemsForResolution } from "./regenerateItems.js";

export async function regenerateForResolution(printPrecision) {
  const state = useStore.getState();
  const newItems = await regenerateItemsForResolution(
    state.items,
    printPrecision,
    // Publish progress so the BusyIndicator can show a progress bar
    // while the regen runs.  Clear it at the end (in the finally below)
    // so the bar doesn't linger after work finishes.
    (p) => useStore.getState().setRegenProgress(p),
  );
  useStore.getState().setRegenProgress(null);
  if (newItems !== state.items) {
    useStore.setState({ items: newItems });
  }
}

// Force every CSG / chamfer regenerator in the current scene to re-run
// from scratch — used by the Timeline's "Recalculate" button.  The
// current items array already reflects every create / transform /
// delete / modify history step (the store's reducers replay history on
// every mutation), so the only thing that can be stale is the cached
// `geometryData` on regenerator items.  Clearing both `regeneratedAt`
// and `geometryData` forces regenerateItemsForResolution to rebuild
// each one via the OCC worker.
export async function recalculateTimeline() {
  const state = useStore.getState();
  const dirtied = state.items.map((item) => {
    if (item.type !== "csg" || !item.regenerator) return item;
    return {
      ...item,
      regenerator: { ...item.regenerator, regeneratedAt: "dirty" },
      geometryData: null,
    };
  });
  useStore.setState({ items: dirtied });
  const printPrecision =
    useStore.getState().curveResolution === "print" ? 0.01 : null;
  const newItems = await regenerateItemsForResolution(
    dirtied,
    printPrecision,
    (p) => useStore.getState().setRegenProgress(p),
  );
  useStore.getState().setRegenProgress(null);
  if (newItems !== dirtied) useStore.setState({ items: newItems });
}
