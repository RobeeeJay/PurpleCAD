import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import { NumberInput, useEscapeKey } from "./inputs.jsx";
import { MM_PER_UNIT } from "../three/sceneObjects/dimensions.js";
import { BAR_STYLE, Field, barInput, barBtn } from "./viewport/overlayBar.js";

// Dimensions dialog for the Box (parametric cube).  Opens on create and from the
// timeline's Edit-dimensions button.  Editing a field previews live (the mesh
// scales in place); Confirm commits the dimensions via modifyItem (which rebuilds
// the geometry), Cancel restores the mesh.
const BoxDialog = () => {
  const boxDialog = useStore((s) => s.boxDialog);
  const items = useStore((s) => s.items);
  const modifyItem = useStore((s) => s.modifyItem);
  const closeBoxDialog = useStore((s) => s.closeBoxDialog);

  const id = boxDialog?.id;
  const item = id != null ? items.find((i) => i.id === id) : null;

  const [w, setW] = useState(20);
  const [h, setH] = useState(20);
  const [d, setD] = useState(20);

  useEffect(() => {
    if (!item) return;
    const dim = item.dimensions || { width: 2, height: 2, depth: 2 };
    setW(+(dim.width * MM_PER_UNIT).toFixed(2));
    setH(+(dim.height * MM_PER_UNIT).toFixed(2));
    setD(+(dim.depth * MM_PER_UNIT).toFixed(2));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = (nw, nh, nd) =>
    useStore.getState()._cameraControls?.previewBoxDimensions?.(id, {
      width: nw / MM_PER_UNIT,
      height: nh / MM_PER_UNIT,
      depth: nd / MM_PER_UNIT,
    });

  const close = () => {
    useStore.getState()._cameraControls?.clearBoxPreview?.(id);
    closeBoxDialog();
  };
  useEscapeKey(!!boxDialog, close);

  if (!boxDialog || !item) return null;

  const confirm = () => {
    modifyItem(
      id,
      {
        dimensions: {
          width: w / MM_PER_UNIT,
          height: h / MM_PER_UNIT,
          depth: d / MM_PER_UNIT,
        },
      },
      "Box dimensions",
    );
    closeBoxDialog();
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") confirm();
    else if (e.key === "Escape") close();
  };
  const field = (label, val, setter, axis) => (
    <Field label={label}>
      <NumberInput
        min="0.01"
        step="1"
        value={val}
        onCommit={(n) => {
          if (!(n > 0)) return;
          setter(n);
          preview(
            axis === "w" ? n : w,
            axis === "h" ? n : h,
            axis === "d" ? n : d,
          );
        }}
        onKeyDown={onKey}
        style={barInput(true)}
      />
    </Field>
  );

  return (
    <>
      <div className="sketch-placement-hint">
        Set the box dimensions (mm), then Confirm · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        {field("W(mm)", w, setW, "w")}
        {field("H(mm)", h, setH, "h")}
        {field("D(mm)", d, setD, "d")}
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

export default BoxDialog;
