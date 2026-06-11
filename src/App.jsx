import React, { useEffect } from "react";
import Toolbar from "./components/Toolbar";
import Viewport from "./components/Viewport";
import TreeView from "./components/TreeView";
import Timeline from "./components/Timeline";
import VariablesDialog from "./components/VariablesDialog";
import ExtrudeLengthDialog from "./components/ExtrudeLengthDialog";
import ChamferEditDialog from "./components/ChamferEditDialog";
import MaterialDialog from "./components/MaterialDialog";
import SettingsDialog from "./components/SettingsDialog";
import VersionTag from "./components/VersionTag";
import "./styles/App.css";
import { useStore } from "./store";

function App() {
  const items = useStore((state) => state.items);
  const theme = useStore((state) => state.theme);
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const undoSketch = useStore((state) => state.undoSketch);
  const redoSketch = useStore((state) => state.redoSketch);
  const notification = useStore((state) => state.notification);
  const clearNotification = useStore((state) => state.clearNotification);

  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(clearNotification, 4000);
    return () => clearTimeout(t);
  }, [notification, clearNotification]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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
      <ExtrudeLengthDialog />
      <ChamferEditDialog />
      <MaterialDialog />
      <SettingsDialog />
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
            pointerEvents: "none",
            lineHeight: 1.45,
          }}
        >
          {notification}
        </div>
      )}
    </div>
  );
}

export default App;
