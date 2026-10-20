import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import SvgIcon from "../icons/SvgIcon.jsx";

const MaterialSection = ({ bare = false }) => {
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const setMaterialDialogTarget = useStore((s) => s.setMaterialDialogTarget);

  const selectedItem = items.find((i) => i.id === selectedId);
  const target =
    selectedItem && selectedItem.type !== "sketch" ? selectedId : "default";

  const body = (
    <button
      className="toolbar-btn"
      title={
        target === "default"
          ? "Material — edit the default material used by new objects"
          : `Material — edit the material for ${selectedItem.name}`
      }
      onClick={() => setMaterialDialogTarget(target)}
    >
      <SvgIcon name="material" size={20} />
    </button>
  );

  if (bare) return body;
  return <ToolbarSection label="Material">{body}</ToolbarSection>;
};

export default MaterialSection;
