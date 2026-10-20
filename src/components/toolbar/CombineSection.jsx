import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import ToolbarDropdown from "./ToolbarDropdown";
import SvgIcon from "../icons/SvgIcon.jsx";

const UnionIcon = () => <SvgIcon name="union" size={20} />;

const DifferenceIcon = () => <SvgIcon name="subtract" size={20} />;

const IntersectionIcon = () => <SvgIcon name="intersect" size={20} />;

// Boolean tools (Union / Difference / Intersection) collapsed into one
// "Boolean" dropdown triggered by the Difference icon.  Each choice opens the
// shared BooleanDialog, which owns object picking — so the menu is available
// even before any object is selected.
const CombineSection = ({ bare = false }) => {
  const startBooleanTool = useStore((s) => s.startBooleanTool);

  const body = (
    <ToolbarDropdown
      trigger={<DifferenceIcon />}
      title="Boolean — Union / Cut / Intersection"
      items={[
        {
          key: "union",
          label: "Union",
          title: "Union — fuse the selected bodies into one solid",
          icon: <UnionIcon />,
          onClick: () => startBooleanTool("union"),
        },
        {
          key: "difference",
          label: "Cut",
          title: "Cut — subtract the cutter bodies from the target",
          icon: <DifferenceIcon />,
          onClick: () => startBooleanTool("difference"),
        },
        {
          key: "intersection",
          label: "Intersection",
          title: "Intersection — keep only the overlapping volume",
          icon: <IntersectionIcon />,
          onClick: () => startBooleanTool("intersection"),
        },
      ]}
    />
  );
  return bare ? body : <ToolbarSection label="Boolean">{body}</ToolbarSection>;
};

export default CombineSection;
