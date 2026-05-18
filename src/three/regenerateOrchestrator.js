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
  );
  if (newItems !== state.items) {
    useStore.setState({ items: newItems });
  }
}
