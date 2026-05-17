import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import { ensureOcc } from "./three/occ/init.js";

// Initialize OpenCascade.js before rendering — all primitive / CSG /
// chamfer code paths assume the kernel is loaded.  The WASM is ~63MB so
// this can take a few seconds on first load; we show a minimal loading
// indicator while it streams in.
const root = ReactDOM.createRoot(document.getElementById("root"));

function LoadingScreen() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1a1a1a",
        color: "#aaa",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      Loading CAD kernel…
    </div>
  );
}

root.render(<LoadingScreen />);

ensureOcc()
  .then(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })
  .catch((err) => {
    console.error("Failed to initialize OpenCascade:", err);
    root.render(
      <div style={{ padding: 20, color: "#f88" }}>
        Failed to load CAD kernel. See console for details.
      </div>,
    );
  });
