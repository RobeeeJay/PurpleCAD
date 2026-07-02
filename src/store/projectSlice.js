// Multi-project management: the list of projects and the active one, plus
// create / switch / rename / delete and thumbnail capture.  Each project owns
// its own timeline / variables / folders / material / camera in the DB (see
// db.js).  Switching resets the store from the target project's data the same
// way documentSlice.loadDocument does.

import * as db from "./db.js";
import {
  replayUpTo,
  withOrphanFlags,
  setNextHistoryId,
  loadMaterialSettings,
} from "./internals.js";
import { DEFAULT_MATERIAL } from "../three/materialPresets.js";

export const projectInitial = {
  projects: db.listProjects(),
  activeProjectId: db.getActiveProjectId(),
};

// Reset the store from a project's persisted data (already the active project in
// the db facade).  Mirrors documentSlice.loadDocument but also restores folders
// + material.
function projectStatePatch() {
  const timeline = db.getTimeline() || {
    history: [
      {
        id: 0,
        label: "Scene created",
        itemId: null,
        instruction: { type: "scene_created" },
        hiddenIds: [],
        _orphaned: false,
      },
    ],
    activeHistoryId: null,
  };
  const history = timeline.history;
  const activeHistoryId = timeline.activeHistoryId ?? null;
  const maxId = Math.max(0, ...history.map((h) => h.id));
  setNextHistoryId(maxId + 1);
  const targetIdx =
    activeHistoryId !== null
      ? history.findIndex((h) => h.id === activeHistoryId)
      : history.length - 1;
  const items = replayUpTo(
    history,
    targetIdx !== -1 ? targetIdx : history.length - 1,
  );
  const mat = loadMaterialSettings();
  return {
    items,
    history: withOrphanFlags(history),
    activeHistoryId,
    variables: db.getVariables(),
    folders: db.getFolders(),
    defaultMaterial: mat.defaultMaterial ?? { ...DEFAULT_MATERIAL },
    materialPresets: mat.materialPresets,
    selectedId: null,
    selectedIds: [],
    hoveredId: null,
    undoStack: [],
    redoStack: [],
  };
}

export const createProjectSlice = (set, get) => ({
  loadProjects: () =>
    set({
      projects: db.listProjects(),
      activeProjectId: db.getActiveProjectId(),
    }),

  // Capture the current viewport into the given project's thumbnail (a reset-
  // view, shaded, overlay-free shot).  Synchronous so it also runs on unload.
  refreshThumbnail: (id) => {
    const thumb = get()._cameraControls?.captureThumbnailDataUrl?.();
    if (thumb) {
      db.setThumbnail(id, thumb);
      set({ projects: db.listProjects() });
    }
  },

  createProject: (name) => {
    get().refreshThumbnail(get().activeProjectId);
    const id = db.createProject(name || "Untitled");
    get().applyProjectSwitch(id);
    set({ projects: db.listProjects() });
  },

  renameProject: (id, name) => {
    db.renameProject(id, name);
    set({ projects: db.listProjects() });
  },

  deleteProject: (id) => {
    const remaining = get().projects.filter((p) => p.id !== id);
    if (remaining.length === 0) return; // never delete the last project
    db.deleteProject(id);
    if (get().activeProjectId === id) get().applyProjectSwitch(remaining[0].id);
    set({ projects: db.listProjects() });
  },

  switchProject: (id) => {
    if (id === get().activeProjectId) return;
    get().refreshThumbnail(get().activeProjectId);
    get().applyProjectSwitch(id);
  },

  // Point the db facade at `id` and reset the store from its data.
  applyProjectSwitch: (id) => {
    db.setActiveProjectId(id);
    set((state) => ({
      ...projectStatePatch(),
      activeProjectId: id,
      cameraResetTrigger: state.cameraResetTrigger + 1,
    }));
  },
});
