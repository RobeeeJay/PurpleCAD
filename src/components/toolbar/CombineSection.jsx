import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import ToolbarDropdown from "./ToolbarDropdown";

const UnionIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    <rect
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      strokeDasharray="2 1.5"
      x="3"
      y="3"
      width="12"
      height="12"
    />
    <rect
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      strokeDasharray="2 1.5"
      x="9"
      y="9"
      width="12"
      height="12"
    />
    <path
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      d="M3 9 L9 9 L9 3 L15 3 L15 9 L21 9 L21 21 L9 21 L9 15 L3 15 Z"
    />
  </svg>
);

const DifferenceIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    <rect
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      x="3"
      y="3"
      width="12"
      height="12"
    />
    <rect
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      strokeDasharray="2 1.5"
      x="9"
      y="9"
      width="12"
      height="12"
    />
    <rect
      stroke="#6C3FD4"
      fill="rgba(108,63,212,0.15)"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      x="3"
      y="3"
      width="6"
      height="6"
    />
    <rect
      stroke="#6C3FD4"
      fill="rgba(108,63,212,0.15)"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      x="9"
      y="3"
      width="6"
      height="6"
    />
    <rect
      stroke="#6C3FD4"
      fill="rgba(108,63,212,0.15)"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      x="3"
      y="9"
      width="6"
      height="6"
    />
  </svg>
);

const IntersectionIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20">
    <rect
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      strokeDasharray="2 1.5"
      x="3"
      y="3"
      width="12"
      height="12"
    />
    <rect
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      strokeDasharray="2 1.5"
      x="9"
      y="9"
      width="12"
      height="12"
    />
    <rect
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      x="9"
      y="9"
      width="6"
      height="6"
    />
  </svg>
);

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
