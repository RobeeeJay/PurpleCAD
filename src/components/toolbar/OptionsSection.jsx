import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import SvgIcon from "../icons/SvgIcon.jsx";

const OptionsSection = () => {
  const setSettingsDialogOpen = useStore((s) => s.setSettingsDialogOpen);

  return (
    <ToolbarSection label="Misc">
      <button
        className="toolbar-btn"
        title="Settings — field of view and snap"
        onClick={() => setSettingsDialogOpen(true)}
      >
        <SvgIcon name="settings-cog" size={20} />
      </button>
    </ToolbarSection>
  );
};

export default OptionsSection;
