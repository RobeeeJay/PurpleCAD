// Defensive check: ELECTRON_RUN_AS_NODE forces the binary into a
// plain-Node shim where `require("electron")` returns the binary path
// string instead of the API.  Some sandboxes (CI runners, certain
// shells) export it by default, so guard with an explicit error
// rather than silently failing with a cryptic "app is undefined".
if (process.env.ELECTRON_RUN_AS_NODE) {
  console.error(
    "Refusing to start: ELECTRON_RUN_AS_NODE is set in the environment.",
  );
  console.error(
    "Unset it (`unset ELECTRON_RUN_AS_NODE`) and re-run `npm run electron:dev`.",
  );
  process.exit(1);
}

const electron = require("electron");
const { app, BrowserWindow, ipcMain, protocol } = electron;
const fsMod = require("fs");
const urlMod = require("url");

// Registering as a standard scheme up front (before app `ready`) makes
// `app://`-served pages behave like HTTPS for fetch + worker semantics.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const path = require("path");

// Load the native OCC addon and register IPC handlers so the renderer can
// invoke OCC operations without accessing Node.js or native modules directly.
// We defer the require to here so the ELECTRON_RUN_AS_NODE guard above fires
// before we attempt to load the addon.
let occBridge = null;
try {
  occBridge = require("./occ-bridge.cjs");
  // performCsg / chamferOrFilletItem are synchronous in C++ but can throw.
  // ipcMain.handle wraps the return value in a promise automatically.
  ipcMain.handle("occ:performCsg", (_e, args) => occBridge.performCsg(args));
  ipcMain.handle("occ:chamferOrFilletItem", (_e, args) =>
    occBridge.chamferOrFilletItem(args),
  );
  ipcMain.handle("occ:exportSTL", (_e, args) => occBridge.exportSTL(args));
  ipcMain.handle("occ:exportSTEP", (_e, args) => occBridge.exportSTEP(args));
} catch (err) {
  // Addon not built or OCC dylib missing — fall back to WASM path in renderer.
  console.warn("[main] native OCC addon unavailable:", err.message);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#101013",
    title: "untitled-cad",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  const DEV_URL = process.env.ELECTRON_START_URL || null;
  // Surface renderer console errors / failed loads in the main
  // process stdout so they show up in the terminal that started the
  // app — easier than opening DevTools every time something breaks.
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) console.log(`[renderer ${level}] ${message}`);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`Renderer failed to load ${url}: ${desc} (${code})`);
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // Load via the registered app:// scheme — `app://./index.html`
    // resolves to dist/index.html and lets fetch() pull other dist
    // assets (including opencascade.wasm) without falling foul of
    // Chromium's file:// fetch ban.
    win.loadURL("app://./index.html");
  }
}

app.whenReady().then(() => {
  // Serve dist files over `app://./<path>`.  Handler decodes the URL
  // and pipes the matching dist file back via a stream response.
  const DIST = path.join(__dirname, "..", "dist");
  protocol.registerFileProtocol("app", (request, callback) => {
    const url = new urlMod.URL(request.url);
    // The host part of `app://./index.html` is "." — strip it.
    const pathname = decodeURIComponent(url.pathname);
    const filePath = path.normalize(path.join(DIST, pathname));
    // Refuse traversal outside dist/.
    if (!filePath.startsWith(DIST)) {
      callback({ error: -10 /* ACCESS_DENIED */ });
      return;
    }
    fsMod.stat(filePath, (err) => {
      if (err) callback({ error: -6 /* FILE_NOT_FOUND */ });
      else callback({ path: filePath });
    });
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
