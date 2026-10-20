import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import ToolbarDropdown from "./ToolbarDropdown";
import SvgIcon from "../icons/SvgIcon.jsx";

// Sketch→solid sweep tools: Revolve, Pipe, Loft — collapsed into one "Sweep"
// dropdown triggered by the Pipe icon.
const RevolveIcon = () => <SvgIcon name="revolve" size={20} />;

const PipeIcon = () => <SvgIcon name="pipe" size={20} />;

const LoftIcon = () => <SvgIcon name="loft" size={20} />;

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
