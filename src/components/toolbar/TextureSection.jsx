import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

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
      <svg viewBox="0 0 24 24" width="20" height="20">
        {/* A cube face carrying a raised-dot texture */}
        <path
          d="M4 8 L12 4 L20 8 L20 17 L12 21 L4 17 Z"
          fill="rgba(108,63,212,0.12)"
          stroke="#c4c2b8"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M4 8 L12 12 L20 8"
          fill="none"
          stroke="#c4c2b8"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <line
          x1="12"
          y1="12"
          x2="12"
          y2="21"
          stroke="#c4c2b8"
          strokeWidth="1.2"
        />
        {/* Bump dots on the two visible faces */}
        <circle cx="8" cy="12.2" r="1.05" fill="#6C3FD4" />
        <circle cx="9.6" cy="15.4" r="1.05" fill="#6C3FD4" />
        <circle cx="6.6" cy="15.2" r="1.05" fill="#6C3FD4" />
        <circle cx="8.2" cy="18.2" r="1.05" fill="#6C3FD4" />
        <circle cx="15.4" cy="12.6" r="1.05" fill="#D4A33F" />
        <circle cx="17.2" cy="15.6" r="1.05" fill="#D4A33F" />
        <circle cx="14.2" cy="15.8" r="1.05" fill="#D4A33F" />
        <circle cx="15.8" cy="18.4" r="1.05" fill="#D4A33F" />
      </svg>
    </button>
  );

  if (bare) return body;
  return <ToolbarSection label="Texture">{body}</ToolbarSection>;
};

export default TextureSection;
