import React from "react";
import { useStore } from "../store";
import "../styles/BusyIndicator.css";

const BusyIndicator = () => {
  const pending = useStore((s) => s.pendingOperations);
  if (pending <= 0) return null;
  return (
    <div className="busy-indicator" role="status" aria-live="polite">
      <div className="busy-spinner" />
      <span className="busy-label">Working…</span>
    </div>
  );
};

export default BusyIndicator;
