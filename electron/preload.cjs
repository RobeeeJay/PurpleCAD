const { contextBridge, ipcRenderer } = require("electron");

// Expose a single invoke helper on window.electronAPI so the renderer can
// call OCC operations on the main process without accessing Node.js directly.
contextBridge.exposeInMainWorld("electronAPI", {
  invokeOcc: (op, args) => ipcRenderer.invoke(`occ:${op}`, args),
  // Synchronous SQLite-backed key/value store (replaces localStorage).  sendSync
  // blocks the renderer briefly but keeps the persistence API synchronous.
  kvGet: (key) => ipcRenderer.sendSync("kv:get", key),
  kvSet: (key, value) => ipcRenderer.sendSync("kv:set", { key, value }),
  kvRemove: (key) => ipcRenderer.sendSync("kv:remove", key),
});
