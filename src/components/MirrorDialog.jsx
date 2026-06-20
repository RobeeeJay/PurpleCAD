import React, { useState, useEffect } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { useDebouncedPreview } from "./inputs.jsx";
import { BAR_STYLE, barBtn, pickBtn } from "./viewport/overlayBar.js";
import { pattern3dItem } from "../three/occClient.js";
import { activePrecision } from "../three/resolution.js";
import { maxItemId } from "../store/internals.js";

const SOLID_TYPES = ["cube", "sphere", "cylinder", "torus", "extrude", "csg"];
const PLANE_TYPES = ["plane", "sketch"];

const isSolid = (item) => item && SOLID_TYPES.includes(item.type);
const isPlane = (item) => item && PLANE_TYPES.includes(item.type);

// Mirror dialog: pick one or more objects and a mirror plane by clicking in the
// 3D view / objects list, then confirm.  Each mirrored object becomes a
// regenerator clone that tracks its source.  Object/plane picking reuses the
// normal viewport selection — the active "Select …" button decides whether a
// click captures objects or the plane.
const MirrorDialog = () => {
  const mirror3dTool = useStore((s) => s.mirror3dTool);
  const cancelMirror3d = useStore((s) => s.cancelMirror3d);
  const selectedIds = useStore((s) => s.selectedIds);
  const setSelection = useStore((s) => s.setSelection);
  const items = useStore((s) => s.items);
  const addItem = useStore((s) => s.addItem);
  const printPrecision = useStore(activePrecision);

  const open = !!mirror3dTool;

  const [objectIds, setObjectIds] = useState([]);
  const [planeId, setPlaneId] = useState(null);
  // Which set the next viewport click contributes to.
  const [pick, setPick] = useState("objects");

  // Seed from the current selection when the dialog opens.
  useEffect(() => {
    if (!open) return;
    const sel = useStore.getState().selectedIds;
    const its = useStore.getState().items;
    const find = (id) => its.find((i) => i.id === id);
    setObjectIds(sel.filter((id) => isSolid(find(id))));
    setPlaneId(sel.find((id) => isPlane(find(id))) ?? null);
    setPick("objects");
  }, [open]);

  // Capture viewport selection changes into whichever set is being picked.
  useEffect(() => {
    if (!open) return;
    const find = (id) => items.find((i) => i.id === id);
    if (pick === "objects") {
      setObjectIds(selectedIds.filter((id) => isSolid(find(id))));
    } else if (pick === "plane") {
      const pl = selectedIds.find((id) => isPlane(find(id)));
      if (pl != null) setPlaneId(pl);
    }
  }, [selectedIds, pick, open, items]);

  const plane = items.find((i) => i.id === planeId);
  const valid = objectIds.length > 0 && !!plane;

  // Mirror every picked object across the plane; returns [{ sourceId, result }].
  const buildResults = async () => {
    if (!valid) return null;
    const rot = plane.rotation || { x: 0, y: 0, z: 0 };
    const nv = new THREE.Vector3(0, 0, 1).applyEuler(
      new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0),
    );
    const out = [];
    for (const sourceId of objectIds) {
      const result = await pattern3dItem({
        patternType: "mirror",
        sourceId,
        params: {
          origin: plane.position,
          normal: { x: nv.x, y: nv.y, z: nv.z },
        },
        allItems: items,
        printPrecision,
      });
      if (result) out.push({ sourceId, result });
    }
    return out;
  };

  useDebouncedPreview(
    open && valid,
    async () => {
      const cc = useStore.getState()._cameraControls;
      try {
        const results = await buildResults();
        if (results) cc?.previewPattern3d?.(results.map((r) => r.result));
      } catch {
        cc?.clearPattern3dPreview?.();
      }
    },
    () => useStore.getState()._cameraControls?.clearPattern3dPreview?.(),
    [open, valid, objectIds.join(","), planeId],
  );

  useEffect(() => {
    return () => useStore.getState()._cameraControls?.clearPattern3dPreview?.();
  }, [mirror3dTool]);

  if (!open) return null;

  const close = () => {
    useStore.getState()._cameraControls?.clearPattern3dPreview?.();
    cancelMirror3d();
  };

  // Re-highlight the already-captured set so refining a pick doesn't start blank
  // (and switching back from "plane" doesn't wipe the captured objects).
  const pickObjects = () => {
    setPick("objects");
    setSelection(objectIds);
  };
  const pickPlane = () => {
    setPick("plane");
    setSelection(planeId != null ? [planeId] : []);
  };

  const confirm = async () => {
    let results;
    try {
      results = await buildResults();
    } catch (err) {
      alert("Mirror failed: " + err.message);
      return;
    }
    if (!results || results.length === 0) {
      alert("Mirror produced nothing.");
      return;
    }
    let lastId = null;
    for (const { sourceId, result } of results) {
      const source = items.find((i) => i.id === sourceId);
      const id = maxItemId(useStore.getState().history) + 1;
      addItem({
        id,
        name: `Mirror of ${source?.name ?? "object"}`,
        type: "csg",
        children: [],
        position: result.position,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        geometryData: result.geometryData,
        regenerator: {
          kind: "pattern3d",
          patternType: "mirror",
          sourceId,
          planeId,
          centerOffset: result.centerOffset,
          regeneratedAt: printPrecision,
        },
      });
      lastId = id;
    }
    if (lastId != null) useStore.getState().selectItem?.(lastId);
    close();
  };

  const planeName = plane ? plane.name : "none";
  const objectsLabel =
    objectIds.length === 0
      ? "none"
      : objectIds.length === 1
        ? (items.find((i) => i.id === objectIds[0])?.name ?? "1 object")
        : `${objectIds.length} objects`;

  return (
    <>
      <div className="sketch-placement-hint">
        Click objects / a plane in the view (shift-click to add) · the lit
        button is what your clicks pick · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <button
          type="button"
          style={pickBtn(pick === "objects")}
          onClick={pickObjects}
          title="Pick the objects to mirror"
        >
          Objects: {objectsLabel}
        </button>
        <button
          type="button"
          style={pickBtn(pick === "plane")}
          onClick={pickPlane}
          title="Pick the mirror plane"
        >
          Plane: {planeName}
        </button>
        <button type="button" onClick={close} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!valid}
          title={valid ? "Create the mirror" : "Pick objects and a plane"}
          style={barBtn(true, !valid)}
        >
          Confirm
        </button>
      </div>
    </>
  );
};

export default MirrorDialog;
