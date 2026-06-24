import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import { NumberInput, useEscapeKey } from "./inputs.jsx";
import { MM_PER_UNIT } from "../three/sceneObjects/dimensions.js";
import { BAR_STYLE, Field, barInput, barBtn } from "./viewport/overlayBar.js";

// Dimensions dialog for the parametric primitives (Box / Sphere / Cylinder /
// Torus / Cone).  Opens on create and from the timeline's Edit-dimensions button.
// Editing a field previews live (the mesh resizes / its shader uniforms update in
// place); Confirm commits the dimensions via modifyItem (which rebuilds it).
const FIELDS = {
  cube: [
    ["W(mm)", "width"],
    ["H(mm)", "height"],
    ["D(mm)", "depth"],
  ],
  sphere: [["Radius(mm)", "radius"]],
  cylinder: [
    ["Radius(mm)", "radius"],
    ["Height(mm)", "height"],
  ],
  torus: [
    ["Major R(mm)", "major"],
    ["Minor R(mm)", "minor"],
  ],
  cone: [
    ["Bottom R(mm)", "radiusBottom"],
    ["Top R(mm)", "radiusTop"],
    ["Height(mm)", "height"],
  ],
};

const PrimitiveDialog = () => {
  const boxDialog = useStore((s) => s.boxDialog);
  const items = useStore((s) => s.items);
  const modifyItem = useStore((s) => s.modifyItem);
  const closeBoxDialog = useStore((s) => s.closeBoxDialog);

  const id = boxDialog?.id;
  const item = id != null ? items.find((i) => i.id === id) : null;
  const fields = (item && FIELDS[item.type]) || null;

  const [vals, setVals] = useState({});

  useEffect(() => {
    if (!item || !fields) return;
    const dim = item.dimensions || {};
    const v = {};
    for (const [, key] of fields)
      v[key] = +((dim[key] ?? 0) * MM_PER_UNIT).toFixed(2);
    setVals(v);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sceneDims = (v) => {
    const out = {};
    for (const [, key] of fields) out[key] = (v[key] ?? 0) / MM_PER_UNIT;
    return out;
  };
  const previewWith = (v) =>
    useStore
      .getState()
      ._cameraControls?.previewBoxDimensions?.(id, sceneDims(v));

  const close = () => {
    useStore.getState()._cameraControls?.clearBoxPreview?.(id);
    closeBoxDialog();
  };
  useEscapeKey(!!boxDialog, close);

  if (!boxDialog || !item || !fields) return null;

  const confirm = () => {
    modifyItem(id, { dimensions: sceneDims(vals) }, "Dimensions");
    closeBoxDialog();
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") confirm();
    else if (e.key === "Escape") close();
  };

  return (
    <>
      <div className="sketch-placement-hint">
        Set the dimensions (mm), then Confirm · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        {fields.map(([label, key]) => (
          <Field label={label} key={key}>
            <NumberInput
              min="0"
              step="1"
              value={vals[key] ?? 0}
              onCommit={(n) => {
                if (!(n >= 0)) return;
                // A cone's top radius may be 0 (an apex); every other dimension
                // must be positive.
                if (n === 0 && key !== "radiusTop") return;
                const next = { ...vals, [key]: n };
                setVals(next);
                previewWith(next);
              }}
              onKeyDown={onKey}
              style={barInput(true)}
            />
          </Field>
        ))}
        <button type="button" onClick={close} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          title="Confirm dimensions"
          style={barBtn(true)}
        >
          Confirm
        </button>
      </div>
    </>
  );
};

export default PrimitiveDialog;
