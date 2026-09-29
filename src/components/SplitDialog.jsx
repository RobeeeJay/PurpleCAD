import { useStore } from "../store";
import { useEscapeKey } from "./inputs.jsx";
import ToolErrorLine from "./ToolErrorLine.jsx";
import { BAR_STYLE, barBtn, pickBtn } from "./viewport/overlayBar.js";
import { splitItem } from "../three/occClient.js";
import { splitWithFallback } from "../three/meshSplit.js";
import { activePrecision } from "../three/resolution.js";
import { maxItemId } from "../store/internals.js";

// Split dialog: a guided flow with no pre-selection.  Pick the object to split,
// then pick the cut — a Plane/sketch or any solid face (its plane).  Confirm
// slices the object into two separate objects and hides the original.  The
// active "Select …" button decides what a viewport click picks.
const SplitDialog = () => {
  const splitTool = useStore((s) => s.splitTool);
  const splitPick = useStore((s) => s.splitPick);
  const setSplitPick = useStore((s) => s.setSplitPick);
  const cancelSplit3d = useStore((s) => s.cancelSplit3d);
  const items = useStore((s) => s.items);
  const splitIntoParts = useStore((s) => s.splitIntoParts);
  const setToolError = useStore((s) => s.setToolError);
  const printPrecision = useStore(activePrecision);

  const open = !!splitTool;
  const close = () => {
    useStore.getState()._cameraControls?.clearPlanePreview?.();
    cancelSplit3d();
  };
  useEscapeKey(open, close);
  if (!open) return null;

  const { objectId, objectName, cutFrame, cutLabel } = splitTool;
  const valid = objectId != null && !!cutFrame;

  const confirm = async () => {
    const target = items.find((i) => i.id === objectId);
    if (!target || !cutFrame) return;
    const plane = { position: cutFrame.position, rotation: cutFrame.rotation };
    const { result, error } = await splitWithFallback(
      () => splitItem({ target, plane, allItems: items, printPrecision }),
      () =>
        useStore.getState()._cameraControls?.meshSplit?.(target.id, plane) ??
        null,
    );
    if (!result?.partA || !result?.partB) {
      // Nothing came back at all: say why OCC failed.  One side only: the cut
      // misses the body -- a plane that clips only a primitive's box hull gets
      // past the pick-time check.  Going ahead used to replace the body with
      // a renamed copy.
      setToolError(
        !result && error
          ? `Split failed: ${error.message}`
          : `That cut doesn't pass through ${target.name} — pick a face or plane that cuts across it.`,
      );
      return;
    }
    // The halves inherit the body's EFFECTIVE material.  A pattern clone carries
    // no own item.material (it resolves from its source), so read that through;
    // a default-material body stays default (undefined → addItem's default).
    const r = target.regenerator;
    const bodyMaterial =
      r?.kind === "pattern3d" && r.sourceId != null
        ? items.find((i) => i.id === r.sourceId)?.material
        : target.material;
    const firstId = maxItemId(useStore.getState().history) + 1;
    const part = (p, i) => ({
      id: firstId + i,
      name: `${target.name} (${i + 1})`,
      type: "csg",
      children: [],
      parentId: target.parentId ?? null,
      position: p.position,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      geometryData: p.geometryData,
      ...(bodyMaterial && { material: bodyMaterial }),
    });
    // One "Split" step: both halves, with the original hidden from it on.
    splitIntoParts(target.id, [part(result.partA, 0), part(result.partB, 1)]);
    close();
  };

  return (
    <>
      <div className="sketch-placement-hint">
        Click an object, then a plane / sketch / face to cut along · the lit
        button is what your clicks pick · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <button
          type="button"
          style={pickBtn(splitPick === "object")}
          onClick={() => setSplitPick("object")}
          title="Pick the object to split"
        >
          Object: {objectName ?? "none"}
        </button>
        <button
          type="button"
          style={pickBtn(splitPick === "cut")}
          onClick={() => setSplitPick("cut")}
          title="Pick the cut — a face or plane"
        >
          Cut: {cutLabel ?? "none"}
        </button>
        <button type="button" onClick={close} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!valid}
          title={valid ? "Split the object" : "Pick an object and a cut"}
          style={barBtn(true, !valid)}
        >
          Split
        </button>
      </div>
      <ToolErrorLine />
    </>
  );
};

export default SplitDialog;
