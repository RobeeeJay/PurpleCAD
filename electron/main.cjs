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
let occBridge = null;
try {
  occBridge = require("./occ-bridge.cjs");
  // performCsg / chamferOrFilletItem are synchronous in C++ but can throw.
  // ipcMain.handle wraps the return value in a promise automatically.
  ipcMain.handle("occ:performCsg", (_e, args) => occBridge.performCsg(args));
  ipcMain.handle("occ:chamferOrFilletItem", (_e, args) =>
    occBridge.chamferOrFilletItem(args),
  );
  ipcMain.handle("occ:pushPullFaces", (_e, args) =>
    occBridge.pushPullFaces(args),
  );
  ipcMain.handle("occ:shellItem", (_e, args) => occBridge.shellItem(args));
  ipcMain.handle("occ:holeItem", (_e, args) => occBridge.holeItem(args));
  ipcMain.handle("occ:embossItem", (_e, args) => occBridge.embossItem(args));
  ipcMain.handle("occ:draftItem", (_e, args) => occBridge.draftItem(args));
  ipcMain.handle("occ:revolveItem", (_e, args) => occBridge.revolveItem(args));
  ipcMain.handle("occ:pipeItem", (_e, args) => occBridge.pipeItem(args));
  ipcMain.handle("occ:loftItem", (_e, args) => occBridge.loftItem(args));
  ipcMain.handle("occ:exportSTL", (_e, args) => occBridge.exportSTL(args));
  ipcMain.handle("occ:exportSTEP", (_e, args) => occBridge.exportSTEP(args));
  ipcMain.handle("occ:importStep", (_e, args) => occBridge.importStep(args));
  ipcMain.handle("occ:splitItem", (_e, args) => occBridge.splitItem(args));
  ipcMain.handle("occ:pattern3dItem", (_e, args) =>
    occBridge.pattern3dItem(args),
  );
  ipcMain.handle("occ:releaseShape", (_e, args) =>
    occBridge.releaseShape(args),
  );
  ipcMain.handle("occ:solidFromMesh", (_e, args) =>
    occBridge.solidFromMesh(args),
  );
} catch (err) {
  // Addon not built or OCC dylib missing — fall back to WASM path in renderer.
  console.warn("[main] native OCC addon unavailable:", err.message);
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
