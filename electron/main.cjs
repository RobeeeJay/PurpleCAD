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

// In dev mode, watch electron/*.cjs for changes and relaunch automatically.
// watchRenderer: false because Vite HMR already handles renderer hot-reload.
if (process.env.ELECTRON_START_URL) {
  try {
    require("electron-reloader")(module, { watchRenderer: false });
  } catch (_) {}
}

const electron = require("electron");
const { app, BrowserWindow, ipcMain, protocol, session, Menu } = electron;
const fsMod = require("fs");
const urlMod = require("url");

// Name the app so the macOS menu bar, About item, Hide/Quit labels, etc. all
// read "PurpleCAD" rather than "Electron" (set before `ready`).
app.setName("PurpleCAD");

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
// Host the OCC addon in a worker_thread so its synchronous native calls never
// block the main process event loop — a long boolean/chamfer used to freeze the
// whole window (no input, no spinner, no Cancel).  ONE worker only: the addon is
// single-threaded and keeps a shared shape store, so ops must serialise (they
// queue on the worker's event loop in FIFO order).
const { Worker } = require("worker_threads");
let occWorker = null;
const occPending = new Map();
let occNextId = 1;

function failAllOcc(err) {
  for (const p of occPending.values()) p.reject(err);
  occPending.clear();
}

function startOccWorker() {
  const w = new Worker(path.join(__dirname, "occ-worker.cjs"));
  w._intentional = false; // set true when we terminate it on purpose (cancel)
  occWorker = w;
  w.on("message", (msg) => {
    if (msg.id == null) {
      if (msg.ready === false)
        console.warn("[main] OCC worker addon unavailable:", msg.error);
      return;
    }
    const p = occPending.get(msg.id);
    if (!p) return; // late message from a terminated worker — ignore
    occPending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg.result);
  });
  w.on("error", (e) => {
    console.error("[main] OCC worker error:", e.message);
    if (occWorker === w) failAllOcc(e);
  });
  w.on("exit", (code) => {
    if (occWorker === w) failAllOcc(new Error("OCC worker exited"));
    // A crash (or an intentional cancel-terminate) loses the native shape store;
    // restart so the app keeps working — the renderer clears its solid cache on
    // cancel, and a missing id otherwise just rebuilds from recipe.  A deliberate
    // cancel already respawned, so don't double-start.
    if (code !== 0 && !w._intentional && occWorker === w) {
      console.warn("[main] OCC worker exited (" + code + "), restarting");
      startOccWorker();
    }
  });
}

// Genuine cancel: hard-terminate the worker running the (synchronous, otherwise
// un-interruptible) native op, reject everything in flight, and respawn a fresh
// worker.  The native shape store is lost — the renderer clears its solid cache
// so nothing hands out a dangling id.
function cancelOccWorker() {
  const w = occWorker;
  if (!w) return;
  console.log("[OCC] worker TERMINATE — genuine cancel");
  w._intentional = true;
  failAllOcc(new Error("OCC operation cancelled"));
  startOccWorker(); // fresh worker takes over new ops (sets occWorker)
  w.terminate(); // kill the old thread; its exit won't restart (intentional)
}

function callOcc(op, args) {
  return new Promise((resolve, reject) => {
    if (!occWorker) return reject(new Error("OCC worker not started"));
    const id = occNextId++;
    occPending.set(id, { resolve, reject });
    occWorker.postMessage({ id, op, args });
  });
}

try {
  startOccWorker();
  const OCC_OPS = [
    "performCsg", "chamferOrFilletItem", "pushPullFaces", "shellItem",
    "holeItem", "embossItem", "draftItem", "revolveItem", "pipeItem",
    "loftItem", "exportSTL", "exportSTEP", "importStep", "splitItem",
    "pattern3dItem", "releaseShape", "solidFromMesh",
  ];
  for (const op of OCC_OPS)
    ipcMain.handle(`occ:${op}`, (_e, args) => callOcc(op, args));
  ipcMain.handle("occ:cancel", () => {
    cancelOccWorker();
    return true;
  });
} catch (err) {
  console.warn("[main] OCC worker failed to start:", err.message);
}

// SQLite-backed persistence for renderer settings/data (replaces localStorage).
// Synchronous IPC keeps the renderer's load-at-init code path unchanged.
const kvStore = require("./kvStore.cjs");
// Synchronous DB bridge (sendSync): settings, project CRUD, and per-project
// data.  sendSync returns event.returnValue, which Electron structured-clones,
// so structured objects/arrays come back to the renderer intact.
const syncHandlers = {
  "db:settingGet": (a) => kvStore.settingGet(a),
  "db:settingSet": (a) => (kvStore.settingSet(a.key, a.value), true),
  "db:settingRemove": (a) => (kvStore.settingRemove(a), true),
  "db:listProjects": () => kvStore.listProjects(),
  "db:createProject": (a) => kvStore.createProject(a),
  "db:renameProject": (a) => (kvStore.renameProject(a.id, a.name), true),
  "db:deleteProject": (a) => (kvStore.deleteProject(a), true),
  "db:setThumbnail": (a) => (kvStore.setThumbnail(a.id, a.thumbnail), true),
  "db:getActiveProjectId": () => kvStore.getActiveProjectId(),
  "db:setActiveProjectId": (a) => (kvStore.setActiveProjectId(a), true),
  "db:getTimeline": (a) => kvStore.getTimeline(a),
  "db:saveTimeline": (a) => (kvStore.saveTimeline(a.pid, a.data), true),
  "db:getVariables": (a) => kvStore.getVariables(a),
  "db:saveVariables": (a) => (kvStore.saveVariables(a.pid, a.data), true),
  "db:getFolders": (a) => kvStore.getFolders(a),
  "db:saveFolders": (a) => (kvStore.saveFolders(a.pid, a.data), true),
  "db:getMaterial": (a) => kvStore.getMaterial(a),
  "db:saveMaterial": (a) => (kvStore.saveMaterial(a.pid, a.data), true),
  "db:getCamera": (a) => kvStore.getCamera(a),
  "db:saveCamera": (a) => (kvStore.saveCamera(a.pid, a.state), true),
  "db:clearCamera": (a) => (kvStore.clearCamera(a), true),
};
for (const [channel, fn] of Object.entries(syncHandlers)) {
  ipcMain.on(channel, (e, arg) => {
    e.returnValue = fn(arg);
  });
}

// 512px source covers window/taskbar icon use across platforms; packaged
// builds get their app icon from `build.icon` in package.json instead.
const APP_ICON = path.join(
  __dirname,
  "..",
  "app-icons",
  "padded",
  "icon-512.png",
);

// Initial title shown before the page loads; the renderer then sets
// `document.title` to the same string, which Electron mirrors into the
// window/title bar via `page-title-updated`.
const { version: APP_VERSION } = require("../package.json");

function createWindow() {
  // Allow the renderer's Local Font Access API (queryLocalFonts) to enumerate
  // installed fonts for the sketch Text tool. The app only loads its own
  // bundled content, so granting this is safe; other permissions are denied.
  session.defaultSession.setPermissionRequestHandler(
    (_wc, permission, callback) => callback(permission === "local-fonts"),
  );

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#101013",
    title: `PurpleCAD v${APP_VERSION}`,
    icon: APP_ICON,
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

// Application menu.  "About PurpleCAD" opens the SAME in-app About dialog the
// Settings dialog's About button does — main just tells the renderer to show it
// (menu:about), so there's one source of truth for the About contents.
function buildAppMenu() {
  const isMac = process.platform === "darwin";
  const openAbout = () => {
    const win =
      BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    win?.webContents.send("menu:about");
  };
  const aboutItem = { label: `About ${app.name}`, click: openAbout };
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              aboutItem,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      role: "help",
      submenu: isMac ? [] : [aboutItem],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildAppMenu();
  // BrowserWindow's `icon` option doesn't reach the Dock on macOS; packaged
  // builds get their Dock icon from `build.icon`, but dev runs (launched as
  // a bare Electron binary) still show Electron's default unless set here.
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(APP_ICON);
  }

  // Open the database before the window loads so the renderer's first
  // synchronous db read (during store init) finds it ready.
  try {
    kvStore.init(app.getPath("userData"));
  } catch (err) {
    console.warn("[main] SQLite KV store unavailable:", err.message);
  }

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
