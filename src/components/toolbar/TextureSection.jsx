import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import SvgIcon from "../icons/SvgIcon.jsx";

// Texture — displace a picked face set by a black-and-white image (a genuine
// 3D bump map).  One toggle button; the TextureDialog bottom bar owns the rest.
const TextureSection = ({ bare = false }) => {
  const textureTool = useStore((s) => s.textureTool);
  const startTextureTool = useStore((s) => s.startTextureTool);
  const cancelTextureTool = useStore((s) => s.cancelTextureTool);

  const toggleTexture = () => {
    if (textureTool) cancelTextureTool();
    else startTextureTool();
  };

  const body = (
    <button
      className={`toolbar-btn ${textureTool ? "active" : ""}`}
      title="Texture — displace faces with a black-and-white image (3D bump map)"
      onClick={toggleTexture}
    >
      <SvgIcon name="texture" size={20} />
    </button>
  );

  if (bare) return body;
  return <ToolbarSection label="Texture">{body}</ToolbarSection>;
};

export default TextureSection;
