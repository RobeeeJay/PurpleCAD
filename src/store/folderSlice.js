// Tree-view folders -- shown in the UI as Components: groupings of parts for
// the Objects list, which can also carry a motion (see motionSlice.js).
// Folders have no geometry and aren't part of the undo/redo timeline —
// they're persisted to the kv store on their own. Folder ids are
// "folder-N" strings so they never collide with numeric item ids when
// items and folders share the same parentId namespace.

import {
  loadFolders,
  saveFolders,
  saveTimeline,
  withOrphanFlags,
  rewriteCreatedItem,
} from "./internals.js";

export const folderInitial = {
  folders: loadFolders(),
};

export const nextFolderId = (folders) => {
  let max = 0;
  folders.forEach((f) => {
    const n = parseInt(String(f.id).slice("folder-".length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return `folder-${max + 1}`;
};

export const createFolderSlice = (set) => ({
  addFolder: (parentId = null) =>
    set((state) => {
      const folder = {
        id: nextFolderId(state.folders),
        name: "New Component",
        parentId: parentId ?? null,
        expanded: true,
      };
      const folders = [...state.folders, folder];
      saveFolders(folders);
      return { folders };
    }),

  renameFolder: (id, name) =>
    set((state) => {
      const trimmed = name.trim();
      if (!trimmed) return {};
      const folders = state.folders.map((f) =>
        f.id === id ? { ...f, name: trimmed } : f,
      );
      saveFolders(folders);
      return { folders };
    }),

  toggleFolderExpanded: (id) =>
    set((state) => {
      const folders = state.folders.map((f) =>
        f.id === id ? { ...f, expanded: !f.expanded } : f,
      );
      saveFolders(folders);
      return { folders };
    }),

  // Removes the folder and promotes its contents (items and nested
  // folders) to the deleted folder's parent.
  deleteFolder: (id) =>
    set((state) => {
      const folder = state.folders.find((f) => f.id === id);
      if (!folder) return {};
      const newParentId = folder.parentId ?? null;

      const folders = state.folders
        .filter((f) => f.id !== id)
        .map((f) => (f.parentId === id ? { ...f, parentId: newParentId } : f));

      const movedItemIds = state.items
        .filter((i) => i.parentId === id)
        .map((i) => i.id);
      const items = state.items.map((i) =>
        i.parentId === id ? { ...i, parentId: newParentId } : i,
      );

      let history = state.history;
      if (movedItemIds.length) {
        history = state.history.map((entry) =>
          movedItemIds.reduce(
            (e, itemId) =>
              rewriteCreatedItem(e, itemId, (item) => ({
                ...item,
                parentId: newParentId,
              })),
            entry,
          ),
        );
        saveTimeline(history, state.activeHistoryId);
      }

      saveFolders(folders);
      // The component is gone, so anything the motion tools still hold about
      // it goes too -- otherwise its red collision ring stays in the view with
      // nothing to explain it, and its entry keeps the animation loop running.
      const { [id]: _wasPlaying, ...motionPlaying } = state.motionPlaying;
      const editingThis = state.motionTool?.folderId === id;
      return {
        folders,
        items,
        history: withOrphanFlags(history),
        motionPlaying,
        motionCollision:
          state.motionCollision?.folderId === id ? null : state.motionCollision,
        ...(editingThis
          ? {
              motionTool: null,
              selectionOverride: null,
              selectedSubGeometry: null,
            }
          : null),
      };
    }),

  // Drag-and-drop reparenting of a folder into another folder (or to root
  // when newParentId is null). Mirrors reparentItem's circular-ref guard.
  reparentFolder: (folderId, newParentId) =>
    set((state) => {
      if (folderId === newParentId) return {};
      if (newParentId !== null) {
        let cur = newParentId;
        while (cur !== null) {
          if (cur === folderId) return {};
          const curFolder = state.folders.find((f) => f.id === cur);
          if (!curFolder) break;
          cur = curFolder.parentId ?? null;
        }
      }
      const folders = state.folders.map((f) =>
        f.id === folderId ? { ...f, parentId: newParentId ?? null } : f,
      );
      saveFolders(folders);
      return { folders };
    }),
});

export const getDescendantFolderIds = (folderId, folders) => {
  const result = new Set();
  const queue = [folderId];
  while (queue.length > 0) {
    const pid = queue.shift();
    folders.forEach((f) => {
      if (f.parentId === pid) {
        result.add(f.id);
        queue.push(f.id);
      }
    });
  }
  return result;
};
