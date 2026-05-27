const { contextBridge, ipcRenderer } = require("electron");

// Expose a single invoke helper on window.electronAPI so the renderer can
// call OCC operations on the main process without accessing Node.js directly.
contextBridge.exposeInMainWorld("electronAPI", {
  invokeOcc: (op, args) => ipcRenderer.invoke(`occ:${op}`, args),
});
