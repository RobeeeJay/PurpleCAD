import React from "react";
import { useStore } from "../store";
import { useEscapeKey } from "./inputs.jsx";
import { BAR_STYLE, barBtn, pickBtn } from "./viewport/overlayBar.js";
import { splitItem } from "../three/occClient.js";
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
  const addItem = useStore((s) => s.addItem);
  const consumeItems = useStore((s) => s.consumeItems);
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
    let result;
    try {
      result = await splitItem({
        target,
        plane,
        allItems: items,
        printPrecision,
      });
    } catch (err) {
      // OCC couldn't rebuild the target as a solid (imported dense mesh, a
      // pattern, or a sweep whose recipe won't re-resolve) — cut the baked mesh
      // directly instead.
      result =
        useStore.getState()._cameraControls?.meshSplit?.(target.id, plane) ??
        null;
      if (!result) {
        alert("Split failed: " + err.message);
        return;
      }
    }
    if (!result || (!result.partA && !result.partB)) {
      alert("Split produced nothing — does the cut cross the object?");
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
    const add = (part, suffix) => {
      if (!part) return;
      const id = maxItemId(useStore.getState().history) + 1;
      addItem({
        id,
        name: `${target.name} ${suffix}`,
        type: "csg",
        children: [],
        position: part.position,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        geometryData: part.geometryData,
        ...(bodyMaterial && { material: bodyMaterial }),
      });
    };
    add(result.partA, "(1)");
    add(result.partB, "(2)");
    consumeItems([target.id]);
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
    </>
  );
};

export default SplitDialog;
