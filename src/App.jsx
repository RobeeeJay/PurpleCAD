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

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (ctrlOrCmd && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (ctrlOrCmd && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (!isMac && e.ctrlKey && e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

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
