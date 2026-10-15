import React from "react";
import ReactDOM from "react-dom/client";
import { initDb } from "./store/db.js";
import "./styles/index.css";

// Number inputs are keyboard-entry only: a wheel over a focused number field
// would otherwise step its value, so blur it and let the page scroll instead.
document.addEventListener(
  "wheel",
  (e) => {
    const el = document.activeElement;
    if (el && el.type === "number" && el === e.target) el.blur();
  },
  { passive: true },
);

// The store reads persisted settings and the active project as it is
// created, so the persistence cache loads first and the app (which imports
// the store) after it.
initDb().then(async () => {
  const [{ default: App }] = await Promise.all([
    import("./App"),
    import("./api/index.js"),
  ]);
  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
