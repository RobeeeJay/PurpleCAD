import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { isAnalysableBody } from "../../store/stressSlice.js";

// Stress — hold some faces, load others, and colour the body by how hard it is
// working.  One toggle button; StressOverlay's bottom bar owns the rest.
//
// Works on anything with a surface in the scene, not only bodies carrying a
// baked mesh: an extrude is built analytically in the renderer and has no
// geometryData at all, and reading that alone left the button dead on one.
const StressSection = ({ bare = false }) => {
  const stressTool = useStore((s) => s.stressTool);
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const startStressTool = useStore((s) => s.startStressTool);
  const cancelStressTool = useStore((s) => s.cancelStressTool);

  const selected = items.find((i) => i.id === selectedId);
  const ready = isAnalysableBody(selected);

  const toggle = () => {
    if (stressTool) cancelStressTool();
    else if (ready) startStressTool(selectedId);
  };

  const body = (
    <button
      className={`toolbar-btn ${stressTool ? "active" : ""}`}
      title={
        ready || stressTool
          ? "Stress — hold faces, load others, and colour the body by von Mises stress"
          : "Stress — select a body first"
      }
      disabled={!ready && !stressTool}
      onClick={toggle}
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        {/* A beam held at its left end, bending under a load, banded by stress */}
        <rect
          x="3"
          y="4"
          width="2.4"
          height="16"
          fill="#c4c2b8"
          opacity="0.55"
        />
        <path
          d="M5.4 9 L20 10.6 L20 15 L5.4 15 Z"
          fill="#7f2618"
          opacity="0.9"
        />
        <path d="M5.4 9 L12 9.7 L12 15 L5.4 15 Z" fill="#d16a4e" />
        <path d="M5.4 9 L8 9.3 L8 15 L5.4 15 Z" fill="#e6907a" />
        <path
          d="M20 6 L20 10"
          stroke="#D4A33F"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M18.4 8.6 L20 10.6 L21.6 8.6"
          fill="none"
          stroke="#D4A33F"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );

  if (bare) return body;
  return <ToolbarSection label="Stress">{body}</ToolbarSection>;
};

export default StressSection;
