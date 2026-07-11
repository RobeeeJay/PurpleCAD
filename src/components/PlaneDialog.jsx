import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import FormulaInput from "./FormulaInput";
import { evalValue, useEscapeKey } from "./inputs.jsx";
import {
  BAR_STYLE,
  Field,
  barInput,
  barBtn,
  pickBtn,
} from "./viewport/overlayBar.js";
import { applyPlaneAdjust } from "../three/planeFrame.js";
import { maxItemId } from "../store/internals.js";
import { MM_PER_UNIT } from "../three/sceneObjects.js";

// Create a Plane object from a base frame (a selected sketch's plane, or the
// default XY), adjusting its rotation (degrees per axis) and an offset along the
// plane normal, with a live preview.  Confirm adds a `plane` item.
const PlaneDialog = () => {
  const planeTool = useStore((s) => s.planeTool);
  const cancelPlaneTool = useStore((s) => s.cancelPlaneTool);
  const updatePlaneTool = useStore((s) => s.updatePlaneTool);
  const setPlanePickActive = useStore((s) => s.setPlanePickActive);
  const variables = useStore((s) => s.variables);
  const addItem = useStore((s) => s.addItem);

  const [rx, setRx] = useState("0");
  const [ry, setRy] = useState("0");
  const [rz, setRz] = useState("0");
  const [offset, setOffset] = useState("0");

  const open = !!planeTool?.base;

  useEffect(() => {
    if (open) {
      setRx("0");
      setRy("0");
      setRz("0");
      setOffset("0");
    }
  }, [open]);

  const rxv = evalValue(rx, variables);
  const ryv = evalValue(ry, variables);
  const rzv = evalValue(rz, variables);
  const offv = evalValue(offset, variables);
  const valid =
    Number.isFinite(rxv) &&
    Number.isFinite(ryv) &&
    Number.isFinite(rzv) &&
    Number.isFinite(offv);

  const finalFrame = () =>
    applyPlaneAdjust(
      planeTool.base,
      // Fields are in the Z-up display frame (user X,Y,Z = internal x,−z,y);
      // applyPlaneAdjust takes internal-frame angles.
      { x: rxv, y: rzv, z: -ryv },
      // Offset is entered in mm; the scene works in scene units.
      offv / MM_PER_UNIT,
    );

  // Live preview as the values change.  Depend on planeTool.base too so picking
  // a new base (XY/XZ/YZ, a face, or 3 points) re-runs the preview even when the
  // rotation/offset deltas stay at zero.
  useEffect(() => {
    if (!open) return;
    const cc = useStore.getState()._cameraControls;
    if (valid) cc?.previewPlane?.(finalFrame());
    return () => useStore.getState()._cameraControls?.clearPlanePreview?.();
  }, [open, valid, rxv, ryv, rzv, offv, planeTool?.base]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    useStore.getState()._cameraControls?.clearPlanePreview?.();
    cancelPlaneTool();
  };
  useEscapeKey(open, close);

  if (!open) return null;

  const confirm = () => {
    if (!valid) return;
    const { position, rotation } = finalFrame();
    const id = maxItemId(useStore.getState().history) + 1;
    addItem({
      id,
      name: `Plane ${id}`,
      type: "plane",
      children: [],
      position,
      rotation,
      scale: { x: 1, y: 1, z: 1 },
    });
    useStore.getState().selectItem?.(id);
    close();
  };

  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") confirm();
    else if (e.key === "Escape") close();
  };

  // Swap the base frame to a world axis-plane (resetting the rotation deltas).
  const setBase = (rotation) => {
    updatePlaneTool({ base: { position: { x: 0, y: 0, z: 0 }, rotation } });
    setRx("0");
    setRy("0");
    setRz("0");
    setOffset("0");
  };
  const startPick = (mode) => {
    useStore.getState()._cameraControls?.clearPlanePreview?.();
    cancelPlaneTool();
    setPlanePickActive(mode);
  };

  return (
    <>
      <div className="sketch-placement-hint">
        Set the plane options, then Confirm · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <Field label="Base:">
          {/* Labels are the Z-up display frame: XY is the ground plane
              (internal xz), XZ the vertical internal-xy plane; YZ is the same
              plane in both frames. */}
          <button
            type="button"
            style={pickBtn()}
            onClick={() => setBase({ x: -Math.PI / 2, y: 0, z: 0 })}
          >
            XY
          </button>
          <button
            type="button"
            style={pickBtn()}
            onClick={() => setBase({ x: 0, y: 0, z: 0 })}
          >
            XZ
          </button>
          <button
            type="button"
            style={pickBtn()}
            onClick={() => setBase({ x: 0, y: Math.PI / 2, z: 0 })}
          >
            YZ
          </button>
          <button
            type="button"
            style={pickBtn()}
            onClick={() => startPick("points")}
          >
            3 points
          </button>
          <button
            type="button"
            style={pickBtn()}
            onClick={() => startPick("face")}
          >
            Face
          </button>
        </Field>
        <Field label="Rot X°">
          <FormulaInput
            variables={variables}
            autoFocus
            value={rx}
            onChange={(e) => setRx(e.target.value)}
            onKeyDown={onKey}
            style={barInput(Number.isFinite(rxv))}
          />
        </Field>
        <Field label="Y°">
          <FormulaInput
            variables={variables}
            value={ry}
            onChange={(e) => setRy(e.target.value)}
            onKeyDown={onKey}
            style={barInput(Number.isFinite(ryv))}
          />
        </Field>
        <Field label="Z°">
          <FormulaInput
            variables={variables}
            value={rz}
            onChange={(e) => setRz(e.target.value)}
            onKeyDown={onKey}
            style={barInput(Number.isFinite(rzv))}
          />
        </Field>
        <Field label="Offset(mm)">
          <FormulaInput
            variables={variables}
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            onKeyDown={onKey}
            style={barInput(Number.isFinite(offv))}
          />
        </Field>
        <button type="button" onClick={close} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!valid}
          title={valid ? "Create the plane" : "Enter valid values"}
          style={barBtn(true, !valid)}
        >
          Create
        </button>
      </div>
    </>
  );
};

export default PlaneDialog;
