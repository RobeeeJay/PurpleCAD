import React from "react";
import { useStore } from "../store";
import { splitItem } from "../three/occClient.js";
import { activePrecision } from "../three/resolution.js";
import { maxItemId } from "../store/internals.js";
import "../styles/VariablesDialog.css";

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
  if (!open) return null;

  const { objectId, objectName, cutFrame, cutLabel } = splitTool;
  const valid = objectId != null && !!cutFrame;

  const close = () => {
    useStore.getState()._cameraControls?.clearPlanePreview?.();
    cancelSplit3d();
  };

  const confirm = async () => {
    const target = items.find((i) => i.id === objectId);
    if (!target || !cutFrame) return;
    let result;
    try {
      result = await splitItem({
        target,
        plane: { position: cutFrame.position, rotation: cutFrame.rotation },
        allItems: items,
        printPrecision,
      });
    } catch (err) {
      alert("Split failed: " + err.message);
      return;
    }
    if (!result || (!result.partA && !result.partB)) {
      alert("Split produced nothing — does the cut cross the object?");
      return;
    }
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
        ...(target.material && { material: target.material }),
      });
    };
    add(result.partA, "(1)");
    add(result.partB, "(2)");
    consumeItems([target.id]);
    close();
  };

  const pickBtn = (active) => ({
    flex: 1,
    fontSize: 12,
    padding: "8px 10px",
    borderRadius: 4,
    border: `1px solid ${active ? "#6C3FD4" : "var(--border-color)"}`,
    background: active ? "rgba(108,63,212,0.18)" : "var(--bg-tertiary)",
    color: "var(--text-primary)",
    cursor: "pointer",
    textAlign: "left",
  });
  const sub = { fontSize: 11, color: "var(--text-secondary)", marginTop: 3 };

  return (
    <div
      className="variables-dialog-backdrop"
      style={{
        background: "transparent",
        alignItems: "flex-end",
        paddingBottom: 72,
        pointerEvents: "none",
      }}
    >
      <div
        className="variables-dialog"
        style={{ minWidth: 320, pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="variables-dialog-header">
          <h2>Split object</h2>
          <button
            className="variables-dialog-close"
            onClick={close}
            title="Cancel"
          >
            ×
          </button>
        </div>
        <div
          style={{
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <button
            type="button"
            style={pickBtn(splitPick === "object")}
            onClick={() => setSplitPick("object")}
          >
            <div>Select object</div>
            <div style={sub}>{objectName ?? "none"}</div>
          </button>
          <button
            type="button"
            style={pickBtn(splitPick === "cut")}
            onClick={() => setSplitPick("cut")}
          >
            <div>Select cut (face or plane)</div>
            <div style={sub}>{cutLabel ?? "none"}</div>
          </button>
          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
            Click an object in the view, then a plane, a sketch, or a face to
            cut it along. The highlighted button shows what your click picks.
          </div>
        </div>
        <div className="variables-dialog-footer">
          <div />
          <div className="variables-dialog-actions">
            <button className="variables-btn" onClick={close}>
              Cancel
            </button>
            <button
              className="variables-btn primary"
              disabled={!valid}
              onClick={confirm}
            >
              Split
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SplitDialog;
