import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./api/index.js";
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

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
