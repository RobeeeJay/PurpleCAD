import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { isAnalysableBody } from "../../store/stressSlice.js";
import SvgIcon from "../icons/SvgIcon.jsx";

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
      <SvgIcon name="stress" size={20} />
    </button>
  );

  if (bare) return body;
  return <ToolbarSection label="Stress">{body}</ToolbarSection>;
};

export default StressSection;
