import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { isAnalysableBody } from "../../store/stressSlice.js";
import SvgIcon from "../icons/SvgIcon.jsx";

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
      <SvgIcon name="generative-design" size={20} />
    </button>
  );

  if (bare) return body;
  return <ToolbarSection label="Optimise">{body}</ToolbarSection>;
};

export default OptimiseSection;
