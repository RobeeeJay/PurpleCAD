import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import { maxItemId } from "../store/internals.js";
import { NumberInput, useEscapeKey } from "./inputs.jsx";
import { MM_PER_UNIT } from "../three/sceneObjects/dimensions.js";
import { BAR_STYLE, Field, barInput, barBtn } from "./viewport/overlayBar.js";

// Dimensions dialog for the parametric primitives (Box / Sphere / Cylinder /
// Torus / Cone).  Two modes:
//   • create — opened by a Create button; a translucent GHOST previews live and
//     nothing is added to the timeline until Confirm (then a single addItem).
//   • edit   — opened by the timeline's Edit-dimensions button; the real mesh
//     previews live and Confirm commits via modifyItem.
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

const DEFAULTS = {
  cube: { width: 2, height: 2, depth: 2 },
  sphere: { radius: 1.5 },
  cylinder: { radius: 1, height: 2 },
  torus: { major: 1, minor: 0.4 },
  cone: { radiusBottom: 1, radiusTop: 0, height: 2 },
};

const PrimitiveDialog = () => {
  const boxDialog = useStore((s) => s.boxDialog);
  const items = useStore((s) => s.items);
  const history = useStore((s) => s.history);
  const addItem = useStore((s) => s.addItem);
  const modifyItem = useStore((s) => s.modifyItem);
  const selectItem = useStore((s) => s.selectItem);
  const closeBoxDialog = useStore((s) => s.closeBoxDialog);

  const isCreate = !!boxDialog?.create;
  const id = boxDialog?.id;
  const item = id != null ? items.find((i) => i.id === id) : null;
  const type = isCreate ? boxDialog.create.type : item?.type;
  const fields = (type && FIELDS[type]) || null;

  const [vals, setVals] = useState({});

  const sceneDims = (v) => {
    const out = {};
    for (const [, key] of fields) out[key] = (v[key] ?? 0) / MM_PER_UNIT;
    return out;
  };
  const preview = (v) => {
    const cc = useStore.getState()._cameraControls;
    if (isCreate)
      cc?.showPrimitivePreview?.({
        type,
        dimensions: sceneDims(v),
        position: boxDialog.create.position,
      });
    else cc?.previewBoxDimensions?.(id, sceneDims(v));
  };

  // Seed the fields (from the item, or the type's defaults for a create) and show
  // the initial preview when the dialog opens.
  useEffect(() => {
    if (!fields) return;
    const dim = isCreate ? DEFAULTS[type] : item.dimensions || {};
    const v = {};
    for (const [, key] of fields)
      v[key] = +((dim[key] ?? 0) * MM_PER_UNIT).toFixed(2);
    setVals(v);
    preview(v);
  }, [boxDialog]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    const cc = useStore.getState()._cameraControls;
    if (isCreate) cc?.clearPrimitivePreview?.();
    else cc?.clearBoxPreview?.(id);
    closeBoxDialog();
  };
  useEscapeKey(!!boxDialog, close);

  if (!boxDialog || !fields) return null;

  const confirm = () => {
    const dims = sceneDims(vals);
    if (isCreate) {
      const newId = maxItemId(history) + 1;
      const label =
        type === "cube" ? "Box" : type.charAt(0).toUpperCase() + type.slice(1);
      addItem({
        id: newId,
        name: `${label} ${newId}`,
        type,
        children: [],
        position: boxDialog.create.position,
        scale: { x: 1, y: 1, z: 1 },
        dimensions: dims,
      });
      selectItem?.(newId);
      useStore.getState()._cameraControls?.clearPrimitivePreview?.();
    } else {
      // Only commit (and trigger a rebuild) when a dimension actually changed —
      // confirming an unedited box must NOT add a no-op step.
      const cur = item.dimensions || {};
      const changed = fields.some(
        ([, k]) => Math.abs((cur[k] ?? 0) - dims[k]) > 1e-9,
      );
      if (changed) modifyItem(id, { dimensions: dims }, "Dimensions");
      else useStore.getState()._cameraControls?.clearBoxPreview?.(id);
    }
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
                preview(next);
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
          title={isCreate ? "Create" : "Confirm dimensions"}
          style={barBtn(true)}
        >
          {isCreate ? "Create" : "Confirm"}
        </button>
      </div>
    </>
  );
};

export default PrimitiveDialog;
