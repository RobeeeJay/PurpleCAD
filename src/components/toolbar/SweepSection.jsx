import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import ToolbarDropdown from "./ToolbarDropdown";

// Sketch→solid sweep tools: Revolve, Pipe, Loft — collapsed into one "Sweep"
// dropdown triggered by the Pipe icon.
const RevolveIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    {/* axis */}
    <line
      stroke="#D4A33F"
      strokeWidth="1.5"
      strokeDasharray="2 2"
      x1="5"
      y1="2"
      x2="5"
      y2="22"
    />
    {/* profile */}
    <rect
      x="9"
      y="8"
      width="4"
      height="8"
      fill="rgba(108,63,212,0.3)"
      stroke="#6C3FD4"
      strokeWidth="1.5"
    />
    {/* swept body hint */}
    <path
      d="M9 8 C 17 8, 21 10, 21 12 C 21 14, 17 16, 13 16"
      fill="none"
      stroke="#c4c2b8"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M9 16 C 16 16, 20 14, 20 12"
      fill="none"
      stroke="#c4c2b8"
      strokeWidth="1"
      strokeDasharray="2 2"
    />
  </svg>
);

const PipeIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    {/* path (the spine) */}
    <path
      d="M4 20 L4 9 C4 6, 6 4, 9 4 L20 4"
      fill="none"
      stroke="#D4A33F"
      strokeWidth="1.5"
      strokeDasharray="2 2"
      strokeLinecap="round"
    />
    {/* profile at the start */}
    <rect
      x="1.5"
      y="17"
      width="5"
      height="5"
      fill="rgba(108,63,212,0.3)"
      stroke="#6C3FD4"
      strokeWidth="1.5"
    />
    {/* swept tube hint */}
    <path
      d="M7 20 L7 9 C7 8, 8 7, 9 7 L20 7"
      fill="none"
      stroke="#c4c2b8"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M1.5 9 C1.5 8, 2.5 7, 4 7"
      fill="none"
      stroke="#c4c2b8"
      strokeWidth="1"
    />
  </svg>
);

const LoftIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    {/* top (smaller) profile */}
    <rect
      x="9"
      y="3"
      width="6"
      height="4"
      fill="rgba(108,63,212,0.3)"
      stroke="#6C3FD4"
      strokeWidth="1.5"
    />
    {/* bottom (larger) profile */}
    <rect
      x="4"
      y="17"
      width="16"
      height="4"
      fill="rgba(108,63,212,0.3)"
      stroke="#6C3FD4"
      strokeWidth="1.5"
    />
    {/* lofted sides */}
    <line x1="9" y1="7" x2="4" y2="17" stroke="#c4c2b8" strokeWidth="1.5" />
    <line x1="15" y1="7" x2="20" y2="17" stroke="#c4c2b8" strokeWidth="1.5" />
  </svg>
);

const SWEEPS = [
  {
    kind: "revolve",
    label: "Revolve",
    title: "Revolve — spin a sketch profile around a picked axis",
    icon: <RevolveIcon />,
    title:
      "Revolve — sweep a sketch profile around an axis line (toggle Prism for a faceted sweep)",
  },
  {
    kind: "pipe",
    label: "Pipe",
    title: "Pipe — sweep a circular section along a sketch path",
    icon: <PipeIcon />,
    title:
      "Pipe — sweep a sketch profile along a path line from another sketch",
  },
  {
    kind: "loft",
    label: "Loft",
    title: "Loft — blend between two sketch profiles",
    icon: <LoftIcon />,
    title: "Loft — blend a solid between two sketch regions on parallel planes",
  },
];

const SweepSection = ({ bare = false }) => {
  const sweepSelectMode = useStore((s) => s.sweepSelectMode);
  const startSweepTool = useStore((s) => s.startSweepTool);
  const cancelSweepTool = useStore((s) => s.cancelSweepTool);

  const toggle = (kind) => {
    if (sweepSelectMode?.kind === kind) {
      useStore.getState()._cameraControls?.cancelSweep?.();
      cancelSweepTool();
    } else {
      startSweepTool(kind);
    }
  };

  const body = (
    <ToolbarDropdown
      trigger={<PipeIcon />}
      title="Sweep — Revolve / Pipe / Loft"
      triggerActive={!!sweepSelectMode}
      items={SWEEPS.map((s) => ({
        key: s.kind,
        label: s.label,
        title: s.title,
        icon: s.icon,
        active: sweepSelectMode?.kind === s.kind,
        onClick: () => toggle(s.kind),
      }))}
    />
  );

  return bare ? body : <ToolbarSection label="Modify">{body}</ToolbarSection>;
};

export default SweepSection;
