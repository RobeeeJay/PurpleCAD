import React from "react";
import { useStore } from "../store";
import "../styles/PathTraceProgress.css";

// Thin progress bar across the top of the viewport while the path tracer is
// accumulating samples. Resets to empty whenever the camera moves (the
// accumulation buffer resets too), and fills back up as samples accrue.
const PathTraceProgress = () => {
  const pathTracerActive = useStore((s) => s.pathTracerActive);
  const progress = useStore((s) => s.pathTraceProgress);

  if (!pathTracerActive || !progress) return null;

  const pct = Math.min(
    100,
    Math.round((progress.samples / progress.target) * 100),
  );

  return (
    <div
      className="path-trace-progress"
      role="progressbar"
      aria-label="Path trace render progress"
      aria-valuemin={0}
      aria-valuemax={progress.target}
      aria-valuenow={progress.samples}
    >
      <div className="path-trace-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
};

export default PathTraceProgress;
