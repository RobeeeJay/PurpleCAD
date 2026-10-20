import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { enumerateSystemFonts } from "../../three/sketchText.js";
import { CogArt } from "../icons/constraintIconArt.jsx";
import SvgIcon from "../icons/SvgIcon.jsx";

const SKETCH_TOOLS = [
  {
    id: "rect",
    label: "Rectangle",
    icon: <SvgIcon name="rectangle" size={20} />,
  },
  {
    id: "circle",
    label: "Circle",
    icon: <SvgIcon name="circle" size={20} />,
  },
  {
    id: "ellipse",
    label: "Ellipse",
    icon: <SvgIcon name="ellipse" size={20} />,
  },
  {
    id: "line",
    label: "Line",
    icon: <SvgIcon name="line" size={20} />,
  },
  {
    id: "arc",
    label: "Arc",
    icon: <SvgIcon name="arc" size={20} />,
  },
  {
    id: "point",
    label: "Point — click to place a point; on a line it's constrained to it",
    icon: <SvgIcon name="point" size={20} />,
  },
  {
    id: "bezier",
    label: "Bezier — click start then end; select it to drag the handles",
    icon: <SvgIcon name="spline" size={20} />,
  },
  {
    id: "text",
    label: "Text — click a start point, then type in the dialog",
    icon: <SvgIcon name="text" size={20} />,
  },
  {
    id: "cog",
    label: "Cog — pick a centre point, then set the gear in the dialog",
    icon: <CogArt />,
  },
];

const SketchDrawSection = () => {
  const activeSketchTool = useStore((s) => s.activeSketchTool);
  const setActiveSketchTool = useStore((s) => s.setActiveSketchTool);
  const startCogTool = useStore((s) => s.startCogTool);
  const cancelCogTool = useStore((s) => s.cancelCogTool);

  return (
    <ToolbarSection label="Draw">
      {SKETCH_TOOLS.map((tool) => (
        <button
          key={tool.id}
          className={`toolbar-btn ${activeSketchTool === tool.id ? "active" : ""}`}
          title={tool.label}
          onClick={() => {
            // Kick off system-font enumeration on the text tool's click — a real
            // user gesture, so the Local Font Access permission prompt can fire
            // and the (slow) first query is likely done before the dialog opens.
            if (tool.id === "text" && activeSketchTool !== "text")
              enumerateSystemFonts();
            // The cog opens its dialog straight away, Centre button live.
            if (tool.id === "cog") {
              if (activeSketchTool === "cog") cancelCogTool();
              else startCogTool();
              return;
            }
            setActiveSketchTool(activeSketchTool === tool.id ? null : tool.id);
          }}
        >
          {tool.icon}
        </button>
      ))}
    </ToolbarSection>
  );
};

export default SketchDrawSection;
