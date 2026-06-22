import React from "react";
import { useStore } from "../store";
import { useEscapeKey } from "./inputs.jsx";
import { BAR_STYLE, LBL, barBtn, pickBtn } from "./viewport/overlayBar.js";

// Point-to-Point move overlay.  Pick a vertex on object A, then a vertex on a
// different object B; Confirm shifts A so its vertex lands on B's.
const PointToPointDialog = () => {
  const tool = useStore((s) => s.pointToPointTool);
  const items = useStore((s) => s.items);
  const setPicking = useStore((s) => s.setPointToPointPicking);
  const cancel = useStore((s) => s.cancelPointToPointTool);
  const setItemsTransform = useStore((s) => s.setItemsTransform);
  const recordTransformHistory = useStore((s) => s.recordTransformHistory);

  const open = !!tool;
  useEscapeKey(open, cancel);
  if (!open) return null;

  const hasA = !!tool.a;
  const hasB = !!tool.b;
  const ready = hasA && hasB;

  const confirm = () => {
    if (!ready) return;
    const itemA = items.find((i) => i.id === tool.a.itemId);
    if (!itemA) return;
    const dx = tool.b.point.x - tool.a.point.x;
    const dy = tool.b.point.y - tool.a.point.y;
    const dz = tool.b.point.z - tool.a.point.z;
    const p = itemA.position || { x: 0, y: 0, z: 0 };
    setItemsTransform([
      { id: itemA.id, position: { x: p.x + dx, y: p.y + dy, z: p.z + dz } },
    ]);
    recordTransformHistory(itemA.id, "Point to Point");
    cancel();
  };

  const hint = tool.picking
    ? "Click a vertex on the object to capture it · Esc to cancel"
    : "Pick Point A and Point B, then Confirm · Esc to cancel";

  return (
    <>
      <div className="sketch-placement-hint">{hint}</div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <span style={LBL}>Move</span>
        <button
          type="button"
          style={pickBtn(tool.picking === "A")}
          onClick={() => setPicking("A")}
          title="Pick the vertex on the object to move"
        >
          {hasA ? "Point A ✓" : "Point A"}
        </button>
        <button
          type="button"
          style={{ ...pickBtn(tool.picking === "B"), marginLeft: 6 }}
          onClick={() => setPicking("B")}
          title="Pick the target vertex on a different object"
        >
          {hasB ? "Point B ✓" : "Point B"}
        </button>
        <button type="button" onClick={cancel} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!ready}
          title={ready ? "Align A onto B" : "Pick both points first"}
          style={barBtn(true, !ready)}
        >
          Confirm
        </button>
      </div>
    </>
  );
};

export default PointToPointDialog;
