// What a body looks like to an agent: its id and name, whether the timeline
// currently hides it, and its size and volume in mm, measured off the surface
// actually on screen.

import { useStore } from "../store";
import { meshStats } from "./frames.js";

// Items that are never bodies, however they are drawn.
export const NON_BODY_TYPES = new Set(["sketch", "plane"]);

// Hidden from the active timeline step on: consumed by a boolean, or hidden
// by the user.
export function isHidden(state, id) {
  const entry =
    state.activeHistoryId != null
      ? state.history.find((h) => h.id === state.activeHistoryId)
      : state.history.at(-1);
  return (entry?.hiddenIds ?? []).includes(id);
}

export function bodySummary(id) {
  const s = useStore.getState();
  const item = s.items.find((i) => i.id === id);
  if (!item) return null;
  const summary = {
    id,
    name: item.name,
    type: item.type,
    hidden: isHidden(s, id),
  };
  const data = s._cameraControls?.meshWorldData?.(id);
  if (!data) return { ...summary, rendered: false };
  const stats = meshStats(data);
  return {
    ...summary,
    bboxMm: { min: stats.min, max: stats.max, size: stats.size },
    volumeMm3: stats.volumeMm3,
    triangles: stats.triangles,
    // A primitive is drawn by a shader on a box hull, so its measured surface
    // is the hull, not the part.
    ...(data.hull ? { approximate: true } : {}),
  };
}
