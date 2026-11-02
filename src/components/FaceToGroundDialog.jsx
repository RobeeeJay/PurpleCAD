import { useEffect } from "react";
import { useStore } from "../store";
import { LAID_ON_FACE } from "../store/uiToolReset.js";
import { useEscapeKey } from "./inputs.jsx";
import { BAR_STYLE, Field, barBtn, pickBtn } from "./viewport/overlayBar.js";

// Drop to ground overlay.  Pick a face: the body turns so that face looks
// straight down, then drops onto the ground.  With no face picked, Confirm
// drops the selection as it stands, as the button always used to.
const FaceToGroundDialog = () => {
  const tool = useStore((s) => s.faceToGroundTool);
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const setPicking = useStore((s) => s.setFaceToGroundPicking);
  const cancel = useStore((s) => s.cancelFaceToGroundTool);

  const open = !!tool;
  useEscapeKey(open, cancel);

  const face = tool?.face;
  const faceKey = face ? JSON.stringify(face) : null;
  useEffect(() => {
    const cc = useStore.getState()._cameraControls;
    if (faceKey) cc?.updateFaceToGroundPreview?.();
    else cc?.clearFaceToGroundPreview?.();
    return () =>
      useStore.getState()._cameraControls?.clearFaceToGroundPreview?.();
  }, [faceKey]);

  if (!open) return null;

  const canDropSelection = (
    selectedIds.length > 0 ? selectedIds : [selectedId]
  ).some((id) => {
    const it = items.find((i) => i.id === id);
    return it && it.type !== "sketch";
  });
  const ready = !!face || canDropSelection;

  const confirm = () => {
    const cc = useStore.getState()._cameraControls;
    if (face) {
      const pose = cc?.faceToGroundItemPose?.();
      if (!pose) return;
      const s = useStore.getState();
      s.setItemsTransform([{ id: face.itemId, ...pose }]);
      s.recordTransformHistory(face.itemId, LAID_ON_FACE);
    } else if (canDropSelection) {
      cc?.dropSelectedToGround?.();
    }
    cancel();
  };

  const faceName = face
    ? (items.find((i) => i.id === face.itemId)?.name ?? "Face")
    : null;
  const hint = tool.picking
    ? "Click the face to lay on the ground · Esc to cancel"
    : face
      ? "Confirm to lay the body on this face · Esc to cancel"
      : "Pick a face, or Confirm to drop the selection as it is · Esc to cancel";

  return (
    <>
      <div className="sketch-placement-hint">{hint}</div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <Field
          label="Face"
          hint="The body turns so this face looks straight down, then drops until its lowest point touches the ground."
        >
          <button
            type="button"
            style={pickBtn(tool.picking)}
            onClick={() => setPicking(!tool.picking)}
            title="Pick the face that goes on the ground"
          >
            {face ? `${faceName} ✓` : "Pick face"}
          </button>
        </Field>
        <button type="button" onClick={cancel} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!ready}
          title={
            face
              ? "Lay the body on the face"
              : ready
                ? "Drop the selection to the ground"
                : "Pick a face first"
          }
          style={barBtn(true, !ready)}
        >
          Confirm
        </button>
      </div>
    </>
  );
};

export default FaceToGroundDialog;
