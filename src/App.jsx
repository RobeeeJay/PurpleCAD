import { useEffect } from "react";
import TooltipLayer from "./components/TooltipLayer";
import Toolbar from "./components/Toolbar";
import Viewport from "./components/Viewport";
import TreeView from "./components/TreeView";
import Timeline from "./components/Timeline";
import VariablesDialog from "./components/VariablesDialog";
import PushPullEditDialog from "./components/PushPullEditDialog";
import RevolveEditDialog from "./components/RevolveEditDialog";
import MaterialDialog from "./components/MaterialDialog";
import SettingsDialog from "./components/SettingsDialog";
import AboutDialog from "./components/AboutDialog";
import ProjectDialog from "./components/ProjectDialog";
import TextDialog from "./components/TextDialog";
import ShortcutsOverlay from "./components/ShortcutsOverlay";
import StatusLine from "./components/StatusLine";
import "./styles/StatusLine.css";
import VersionTag from "./components/VersionTag";
import "./styles/App.css";
import { useStore } from "./store";
import { textSimplifyTol } from "./three/resolution.js";
import { ensureFontLoaded } from "./three/sketchText.js";

// __APP_VERSION__ is baked in at build time by Vite's `define` (see
// vite.config.js). Vitest doesn't run through that config so guard with
// `typeof` to keep the test bundle from blowing up.
const APP_VERSION =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

function App() {
  const items = useStore((state) => state.items);
  const theme = useStore((state) => state.theme);
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const undoSketch = useStore((state) => state.undoSketch);
  const redoSketch = useStore((state) => state.redoSketch);
  const notification = useStore((state) => state.notification);
  const clearNotification = useStore((state) => state.clearNotification);
  const notificationAction = useStore((state) => state.notificationAction);

  // Prefix the window/tab title with the active project's name.  Refresh the
  // list once on mount too: at store-init the DB bridge may not have returned
  // rows yet, so this backfills projects/activeProjectId when the app is ready.
  const activeProjectId = useStore((state) => state.activeProjectId);
  const projects = useStore((state) => state.projects);
  const loadProjects = useStore((state) => state.loadProjects);
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);
  // The Electron menu's "About PurpleCAD" opens the same in-app About dialog.
  useEffect(() => {
    window.electronAPI?.onMenuAbout?.(() =>
      useStore.getState().setAboutDialogOpen(true),
    );
  }, []);
  // Capture the active project's thumbnail when leaving the app.
  useEffect(() => {
    const onLeave = () => {
      const s = useStore.getState();
      s.refreshThumbnail?.(s.activeProjectId);
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);
  useEffect(() => {
    const name = projects.find((p) => p.id === activeProjectId)?.name;
    document.title = name ? `${name} — PurpleCAD` : "PurpleCAD";
  }, [projects, activeProjectId]);

  // Keep text glyph contours in sync with the active resolution: backfill
  // shapes that predate contour caching AND re-tessellate ones built at a
  // different density when the print/preview toggle changes.  Gated on a
  // boolean so it settles after the migrating update rather than looping.
  const textTol = useStore(textSimplifyTol);
  const needsTextContours = useStore((state) =>
    state.items.some(
      (it) =>
        it.type === "sketch" &&
        (it.shapes || []).some(
          (s) =>
            s.type === "text" &&
            (!Array.isArray(s.contours) ||
              s.contourTol !== textSimplifyTol(state)),
        ),
    ),
  );
  useEffect(() => {
    if (!needsTextContours) return;
    // Load every text shape's font BEFORE re-tessellating, so a not-yet-loaded
    // system font (eg after a reload) isn't silently rebuilt in the default font.
    const fonts = new Set();
    for (const it of useStore.getState().items)
      if (it.type === "sketch")
        for (const s of it.shapes || [])
          if (s.type === "text" && s.font) fonts.add(s.font);
    let cancelled = false;
    Promise.all([...fonts].map((f) => ensureFontLoaded(f))).then(() => {
      if (!cancelled) useStore.getState().ensureTextContours(textTol);
    });
    return () => {
      cancelled = true;
    };
  }, [needsTextContours, textTol]);

  useEffect(() => {
    if (!notification) return;
    // Long enough to read the message AND reach its button.
    const t = setTimeout(clearNotification, notificationAction ? 12000 : 4000);
    return () => clearTimeout(t);
  }, [notification, notificationAction, clearNotification]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Electron mirrors the page title into the window/title bar via
  // `page-title-updated`, so this also covers the desktop title bar.
  useEffect(() => {
    document.title = `PurpleCAD v${APP_VERSION}`;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const isUndoKey = ctrlOrCmd && e.key === "z" && !e.shiftKey;
      const isRedoKey =
        (ctrlOrCmd && e.key === "z" && e.shiftKey) ||
        (!isMac && e.ctrlKey && e.key === "y");
      if (!isUndoKey && !isRedoKey) return;
      e.preventDefault();
      // Redirect to per-sketch undo/redo when a sketch is open
      const { selectedId: selId, items: its } = useStore.getState();
      const isSketch =
        selId != null && its.find((i) => i.id === selId)?.type === "sketch";
      if (isSketch) {
        if (isUndoKey) undoSketch(selId);
        else redoSketch(selId);
      } else {
        if (isUndoKey) undo();
        else redo();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, undoSketch, redoSketch]);

  return (
    <div className="app-container">
      <Toolbar />
      <div className="main-content">
        <div className="left-panel">
          <TreeView items={items} />
          <Timeline />
        </div>
        <Viewport />
      </div>
      <VariablesDialog />
      <PushPullEditDialog />
      <RevolveEditDialog />
      <MaterialDialog />
      <SettingsDialog />
      <AboutDialog />
      <ProjectDialog />
      <TextDialog />
      <ShortcutsOverlay />
      <TooltipLayer />
      <StatusLine />
      <VersionTag />
      {notification && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "rgba(30, 10, 10, 0.92)",
            color: "#ffaaaa",
            padding: "12px 20px",
            borderRadius: 6,
            fontSize: 13,
            maxWidth: 340,
            textAlign: "center",
            zIndex: 9999,
            pointerEvents: notificationAction ? "auto" : "none",
            lineHeight: 1.45,
          }}
        >
          {notification}
          {notificationAction?.kind === "simplifyToFit" && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                title="Open Simplify on this mesh, set to fit under the limit"
                onClick={() => {
                  const s = useStore.getState();
                  s.clearNotification();
                  s.selectItem(notificationAction.itemId);
                  s.setSimplifyTarget({
                    itemId: notificationAction.itemId,
                    preset: {
                      mode: "triangles",
                      targetTriangles: notificationAction.targetTriangles,
                    },
                  });
                }}
                style={{
                  fontSize: 12,
                  padding: "4px 12px",
                  borderRadius: 3,
                  border: "1px solid var(--accent, #4488ff)",
                  background: "var(--accent, #4488ff)",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Simplify to fit
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
