import React from "react";
import { useStore } from "../store";
import { useEscapeKey } from "./inputs.jsx";
import { BAR_STYLE, barBtn } from "./viewport/overlayBar.js";

// Change-origin chooser.  Opened by clicking an object with the origin tool
// armed: pick the rotation/scale pivot — the centre of mass, the centre of the
// object (bbox centre), or a vertex (which arms a follow-up click).  Rendered
// as the standard bottom-bar overlay.
const OriginDialog = () => {
  const itemId = useStore((s) => s.originDialogItemId);
  const vertexPick = useStore((s) => s.originVertexPick);
  const setOriginVertexPick = useStore((s) => s.setOriginVertexPick);
  const closeOriginDialog = useStore((s) => s.closeOriginDialog);
  const setOriginToolActive = useStore((s) => s.setOriginToolActive);

  const open = itemId != null || vertexPick != null;
  const cancel = () => {
    setOriginVertexPick(null);
    closeOriginDialog();
    setOriginToolActive(false);
  };
  useEscapeKey(open, cancel);

  if (vertexPick != null) {
    return (
      <div className="sketch-placement-hint">
        Click a vertex on the object to set the origin · Esc to cancel
      </div>
    );
  }
  if (itemId == null) return null;

  const apply = (mode) =>
    useStore.getState()._cameraControls?.applyObjectOrigin?.(itemId, mode);
  const pickVertex = () => {
    setOriginVertexPick(itemId);
    closeOriginDialog();
  };

  return (
    <>
      <div className="sketch-placement-hint">
        Choose the object&apos;s new origin · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <button
          type="button"
          style={barBtn()}
          onClick={() => apply("mass")}
          title="Use the centre of mass (volume centroid)"
        >
          Centre of mass
        </button>
        <button
          type="button"
          style={barBtn()}
          onClick={() => apply("object")}
          title="Use the centre of the bounding box"
        >
          Centre of object
        </button>
        <button
          type="button"
          style={barBtn()}
          onClick={pickVertex}
          title="Click a vertex on the object"
        >
          Point (vertex)
        </button>
        <button type="button" style={barBtn(true)} onClick={cancel}>
          Cancel
        </button>
      </div>
    </>
  );
};

export default OriginDialog;
