const { contextBridge, ipcRenderer } = require("electron");

// Expose a single invoke helper on window.electronAPI so the renderer can
// call OCC operations on the main process without accessing Node.js directly.
const sync = (channel, arg) => ipcRenderer.sendSync(channel, arg);

contextBridge.exposeInMainWorld("electronAPI", {
  invokeOcc: (op, args) => ipcRenderer.invoke(`occ:${op}`, args),
  // Synchronous SQLite-backed store (replaces localStorage).  sendSync blocks the
  // renderer briefly but keeps the persistence API synchronous.
  settingGet: (key) => sync("db:settingGet", key),
  settingSet: (key, value) => sync("db:settingSet", { key, value }),
  settingRemove: (key) => sync("db:settingRemove", key),
  projListProjects: () => sync("db:listProjects"),
  projCreate: (name) => sync("db:createProject", name),
  projRename: (id, name) => sync("db:renameProject", { id, name }),
  projDelete: (id) => sync("db:deleteProject", id),
  projSetThumbnail: (id, thumbnail) => sync("db:setThumbnail", { id, thumbnail }),
  projGetActive: () => sync("db:getActiveProjectId"),
  projSetActive: (id) => sync("db:setActiveProjectId", id),
  dbGetTimeline: (pid) => sync("db:getTimeline", pid),
  dbSaveTimeline: (pid, data) => sync("db:saveTimeline", { pid, data }),
  dbGetVariables: (pid) => sync("db:getVariables", pid),
  dbSaveVariables: (pid, data) => sync("db:saveVariables", { pid, data }),
  dbGetFolders: (pid) => sync("db:getFolders", pid),
  dbSaveFolders: (pid, data) => sync("db:saveFolders", { pid, data }),
  dbGetMaterial: (pid) => sync("db:getMaterial", pid),
  dbSaveMaterial: (pid, data) => sync("db:saveMaterial", { pid, data }),
  dbGetCamera: (pid) => sync("db:getCamera", pid),
  dbSaveCamera: (pid, state) => sync("db:saveCamera", { pid, state }),
  dbClearCamera: (pid) => sync("db:clearCamera", pid),
  // Menu → renderer: the native "About PurpleCAD" item opens the in-app dialog.
  // Replaces any prior listener so a re-register can't stack duplicates.
  onMenuAbout: (cb) => {
    ipcRenderer.removeAllListeners("menu:about");
    ipcRenderer.on("menu:about", () => cb());
  },
});
