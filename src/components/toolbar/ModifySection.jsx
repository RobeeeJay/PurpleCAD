import { useMemo } from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { countGeometryComponents } from "../../three/geometryComponents.js";
import SvgIcon from "../icons/SvgIcon.jsx";

const ModifySection = ({ bare = false }) => {
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const splitObject = useStore((s) => s.splitObject);

  const selectedItem = items.find((i) => i.id === selectedId);
  // Splittable when the single selected solid is geometrically more than one
  // disconnected lump — covers unions of non-touching parts, a difference
  // that severed a body, an imported multi-solid, etc.  A welded single body
  // (or a lone primitive) is one component and stays disabled.
  const componentCount = useMemo(
    () => countGeometryComponents(selectedItem?.geometryData),
    [selectedItem?.geometryData],
  );
  const canSplit = selectedIds.length <= 1 && componentCount >= 2;

  const handleSplit = () => {
    if (!canSplit) return;
    splitObject(selectedId);
  };

  const splitButton = (
    <button
      className="toolbar-btn"
      title="Split — separate a union back into its original objects"
      disabled={!canSplit}
      onClick={handleSplit}
    >
      <SvgIcon name="split-object" size={20} />
    </button>
  );

  return bare ? (
    <>{splitButton}</>
  ) : (
    <ToolbarSection label="Modify">{splitButton}</ToolbarSection>
  );
};

export default ModifySection;
