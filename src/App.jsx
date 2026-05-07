import React, { useEffect } from "react";
import Toolbar from "./components/Toolbar";
import Viewport from "./components/Viewport";
import TreeView from "./components/TreeView";
import Timeline from "./components/Timeline";
import "./styles/App.css";
import { useStore } from "./store";

function App() {
  const items = useStore((state) => state.items);
  const theme = useStore((state) => state.theme);
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const undoSketch = useStore((state) => state.undoSketch);
  const redoSketch = useStore((state) => state.redoSketch);

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
      const isRedoKey = (ctrlOrCmd && e.key === "z" && e.shiftKey) || (!isMac && e.ctrlKey && e.key === "y");
      if (!isUndoKey && !isRedoKey) return;
      e.preventDefault();
      // Redirect to per-sketch undo/redo when a sketch is open
      const { selectedId: selId, items: its } = useStore.getState();
      const isSketch = selId != null && its.find((i) => i.id === selId)?.type === "sketch";
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
    </div>
  );
}

export default App;
