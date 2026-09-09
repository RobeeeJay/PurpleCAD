import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { isAnalysableBody } from "../../store/stressSlice.js";

// Generative design — SIMP topology optimisation: keep the material that
// carries the load, remove the rest.  One toggle button; OptimiseOverlay's
// bottom bar owns the rest.
//
// Marked EXPERIMENTAL on every surface it appears on.  The solver is checked
// against closed-form answers and the optimiser against the canonical
// cantilever, but a result is a voxel model at whatever detail was affordable,
// it carries no factor of safety, and nothing here has been validated against
// a physical test.
const OptimiseSection = ({ bare = false }) => {
  const optimiseTool = useStore((s) => s.optimiseTool);
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const start = useStore((s) => s.startOptimiseTool);
  const cancel = useStore((s) => s.cancelOptimiseTool);

  const selected = items.find((i) => i.id === selectedId);
  const ready = isAnalysableBody(selected);

  const toggle = () => {
    if (optimiseTool) cancel();
    else if (ready) start(selectedId);
  };

  const body = (
    <button
      className={`toolbar-btn ${optimiseTool ? "active" : ""}`}
      title={
        ready || optimiseTool
          ? "Generative design (experimental) — remove the material that carries no load"
          : "Generative design (experimental) — select a body first"
      }
      disabled={!ready && !optimiseTool}
      onClick={toggle}
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        {/* A block with its interior optimised away into a truss */}
        <rect x="3" y="4" width="2" height="16" fill="#c4c2b8" opacity="0.55" />
        <path d="M5 4 L20 4 L20 7 L5 7 Z" fill="#6C3FD4" opacity="0.85" />
        <path d="M5 17 L20 17 L20 20 L5 20 Z" fill="#6C3FD4" opacity="0.85" />
        <path d="M6 7 L12 17 L9 17 L5 9 Z" fill="#6C3FD4" opacity="0.6" />
        <path d="M18 7 L12 17 L15 17 L19 9 Z" fill="#6C3FD4" opacity="0.6" />
        <circle cx="20" cy="12" r="1.6" fill="#D4A33F" />
      </svg>
    </button>
  );

  if (bare) return body;
  return <ToolbarSection label="Optimise">{body}</ToolbarSection>;
};

export default OptimiseSection;
