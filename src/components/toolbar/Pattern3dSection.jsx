import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const SOLID_TYPES = ["cube", "sphere", "cylinder", "torus", "extrude", "csg"];
const PLANE_TYPES = ["plane", "sketch"];

// 3D Mirror: clone the selected object across the selected plane.  The clone is
// a regenerator item that rebuilds from the live source, so it tracks changes to
// the original and can't be edited on its own.
const Pattern3dSection = ({ bare = false }) => {
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const startPattern3d = useStore((s) => s.startPattern3d);
  const startMirrorTool = useStore((s) => s.startMirrorTool);

  const sel = selectedIds
    .map((id) => items.find((i) => i.id === id))
    .filter(Boolean);
  const source = sel.find((i) => SOLID_TYPES.includes(i.type));
  const plane = sel.find((i) => PLANE_TYPES.includes(i.type));
  const ready = !!source && !!plane;

  // Circular needs a source + a plane (its normal is the rotation axis);
  // rectangular only needs a source (it tiles along the world X/Y axes).
  const handleCircular = () => {
    if (!source || !plane) {
      alert("Select an object and a plane (its normal is the rotation axis).");
      return;
    }
    startPattern3d({
      patternType: "circular",
      sourceId: source.id,
      planeId: plane.id,
    });
  };
  const handleRectangular = () => {
    if (!source) {
      alert("Select an object to pattern.");
      return;
    }
    startPattern3d({ patternType: "rectangular", sourceId: source.id });
  };

  // Open the Mirror dialog (seeded from the current selection); it owns the
  // object/plane picking and the confirm.
  const handleMirror = () => startMirrorTool();

  const mirrorBtn = (
    <button
      className="toolbar-btn"
      title="Mirror (3D) — clone objects across a plane; the clones track their originals"
      onClick={handleMirror}
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        <line
          x1="12"
          y1="2"
          x2="12"
          y2="22"
          stroke="#D4A33F"
          strokeWidth="1.5"
          strokeDasharray="2 2"
        />
        <polygon
          points="4,7 10,5 10,17 4,19"
          fill="rgba(108,63,212,0.3)"
          stroke="#6C3FD4"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <polygon
          points="20,7 14,5 14,17 20,19"
          fill="rgba(108,63,212,0.12)"
          stroke="#6C3FD4"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );

  const circularBtn = (
    <button
      className="toolbar-btn"
      title="Circular pattern (3D) — clone around the selected plane's normal axis"
      onClick={handleCircular}
      style={ready ? undefined : { opacity: 0.45 }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        <circle
          cx="12"
          cy="12"
          r="8"
          fill="none"
          stroke="#D4A33F"
          strokeWidth="1.5"
          strokeDasharray="2 2"
        />
        <rect x="10.5" y="2.5" width="3" height="3" fill="#6C3FD4" />
        <rect x="18.5" y="10.5" width="3" height="3" fill="#6C3FD4" />
        <rect x="10.5" y="18.5" width="3" height="3" fill="#6C3FD4" />
        <rect x="2.5" y="10.5" width="3" height="3" fill="#6C3FD4" />
      </svg>
    </button>
  );

  const rectangularBtn = (
    <button
      className="toolbar-btn"
      title="Rectangular pattern (3D) — clone the selected object on an X/Y grid"
      onClick={handleRectangular}
      style={source ? undefined : { opacity: 0.45 }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20">
        <rect x="3" y="3" width="4" height="4" fill="#6C3FD4" />
        <rect x="10" y="3" width="4" height="4" fill="rgba(108,63,212,0.45)" />
        <rect x="17" y="3" width="4" height="4" fill="rgba(108,63,212,0.45)" />
        <rect x="3" y="10" width="4" height="4" fill="rgba(108,63,212,0.45)" />
        <rect x="10" y="10" width="4" height="4" fill="rgba(108,63,212,0.45)" />
        <rect x="17" y="10" width="4" height="4" fill="rgba(108,63,212,0.45)" />
        <rect x="3" y="17" width="4" height="4" fill="rgba(108,63,212,0.45)" />
        <rect x="10" y="17" width="4" height="4" fill="rgba(108,63,212,0.45)" />
        <rect x="17" y="17" width="4" height="4" fill="rgba(108,63,212,0.45)" />
      </svg>
    </button>
  );

  const body = (
    <>
      {mirrorBtn}
      {circularBtn}
      {rectangularBtn}
    </>
  );

  return bare ? body : <ToolbarSection label="Modify">{body}</ToolbarSection>;
};

export default Pattern3dSection;
