import React, { useState, useEffect } from "react";
import { useStore } from "../store";
import FormulaInput from "./FormulaInput";
import { evalValue, useDebouncedPreview } from "./inputs.jsx";
import {
  BAR_STYLE,
  LBL,
  barInput,
  barBtn,
  pickBtn,
} from "./viewport/overlayBar.js";
import { pattern3dItem } from "../three/occClient.js";
import { activePrecision } from "../three/resolution.js";
import { maxItemId } from "../store/internals.js";
import { MM_PER_UNIT } from "../three/sceneObjects.js";

// Parameters for a circular or rectangular 3D pattern, with a live preview.
// Circular tiles `count` copies over `angle` about the plane's normal axis;
// rectangular tiles a countX×countY grid along the world X/Y axes.  Confirm adds
// a pattern3d regenerator item that tracks the source.
const Pattern3dDialog = () => {
  const tool = useStore((s) => s.pattern3dTool);
  const cancelPattern3d = useStore((s) => s.cancelPattern3d);
  const setCircularAxisPick = useStore((s) => s.setCircularAxisPick);
  const circularAxisPick = useStore((s) => s.circularAxisPick);
  const items = useStore((s) => s.items);
  const variables = useStore((s) => s.variables);
  const addItem = useStore((s) => s.addItem);
  const printPrecision = useStore(activePrecision);

  const open = !!tool;
  const circular = tool?.patternType === "circular";

  const [count, setCount] = useState("4");
  const [angle, setAngle] = useState("360");
  const [axialOffset, setAxialOffset] = useState("0");
  const [countX, setCountX] = useState("3");
  const [dx, setDx] = useState("50");
  const [countY, setCountY] = useState("1");
  const [dy, setDy] = useState("50");
  const [countZ, setCountZ] = useState("1");
  const [dz, setDz] = useState("50");

  useEffect(() => {
    if (open) {
      setCount("4");
      setAngle("360");
      setAxialOffset("0");
      setCountX("3");
      setDx("50");
      setCountY("1");
      setDy("50");
      setCountZ("1");
      setDz("50");
    }
  }, [open]);

  const countV = evalValue(count, variables);
  const angleV = evalValue(angle, variables);
  const axialOffsetV = evalValue(axialOffset, variables);
  const countXV = evalValue(countX, variables);
  const dxV = evalValue(dx, variables);
  const countYV = evalValue(countY, variables);
  const dyV = evalValue(dy, variables);
  const countZV = evalValue(countZ, variables);
  const dzV = evalValue(dz, variables);

  const valid = circular
    ? Number.isFinite(countV) &&
      countV >= 2 &&
      Number.isFinite(angleV) &&
      angleV > 0 &&
      Number.isFinite(axialOffsetV) &&
      !!tool?.axis
    : Number.isFinite(countXV) &&
      countXV >= 1 &&
      Number.isFinite(countYV) &&
      countYV >= 1 &&
      Number.isFinite(countZV) &&
      countZV >= 1 &&
      Number.isFinite(dxV) &&
      Number.isFinite(dyV) &&
      Number.isFinite(dzV);

  // Resolve the live OCC params + the regenerator to persist.
  const build = () => {
    if (!tool || !valid) return null;
    if (circular) {
      const axis = tool.axis;
      if (!axis) return null;
      const angleRad = (angleV * Math.PI) / 180;
      // Offset is entered in mm (per copy along the axis); store scene units.
      const axialOffsetScene = axialOffsetV / MM_PER_UNIT;
      return {
        params: {
          origin: axis.origin,
          axis: axis.dir,
          count: Math.round(countV),
          angleRad,
          axialOffset: axialOffsetScene,
        },
        regenerator: {
          kind: "pattern3d",
          patternType: "circular",
          sourceId: tool.sourceId,
          // Axis is baked (a picked sketch line / face edge), not a live ref.
          axisOrigin: axis.origin,
          axisDir: axis.dir,
          count: Math.round(countV),
          angleRad,
          axialOffset: axialOffsetScene,
        },
      };
    }
    const sx = dxV / MM_PER_UNIT,
      sy = dyV / MM_PER_UNIT,
      sz = dzV / MM_PER_UNIT;
    const grid = {
      countX: Math.round(countXV),
      countY: Math.round(countYV),
      countZ: Math.round(countZV),
      dx: sx,
      dy: sy,
      dz: sz,
    };
    return {
      params: grid,
      regenerator: {
        kind: "pattern3d",
        patternType: "rectangular",
        sourceId: tool.sourceId,
        ...grid,
      },
    };
  };

  useDebouncedPreview(
    open && valid,
    async () => {
      const args = build();
      const cc = useStore.getState()._cameraControls;
      if (!args) return;
      try {
        const result = await pattern3dItem({
          patternType: tool.patternType,
          sourceId: tool.sourceId,
          params: args.params,
          allItems: items,
          printPrecision,
        });
        cc?.previewPattern3d?.(result);
      } catch {
        cc?.clearPattern3dPreview?.();
      }
    },
    () => useStore.getState()._cameraControls?.clearPattern3dPreview?.(),
    [
      open,
      valid,
      countV,
      angleV,
      axialOffsetV,
      countXV,
      dxV,
      countYV,
      dyV,
      countZV,
      dzV,
      circular,
      tool?.axis,
    ],
  );

  useEffect(() => {
    return () => {
      const cc = useStore.getState()._cameraControls;
      cc?.clearPattern3dPreview?.();
      cc?.clearCircularAxisHighlight?.();
    };
  }, [tool]);

  if (!open) return null;

  const close = () => {
    const cc = useStore.getState()._cameraControls;
    cc?.clearPattern3dPreview?.();
    cc?.clearCircularAxisHighlight?.();
    cancelPattern3d();
  };
  const pickAxis = () => {
    useStore.getState()._cameraControls?.clearPattern3dPreview?.();
    setCircularAxisPick(true);
  };
  const confirm = async () => {
    const args = build();
    if (!args) return;
    let result;
    try {
      result = await pattern3dItem({
        patternType: tool.patternType,
        sourceId: tool.sourceId,
        params: args.params,
        allItems: items,
        printPrecision,
      });
    } catch (err) {
      alert("Pattern failed: " + err.message);
      return;
    }
    if (!result) {
      alert("Pattern produced nothing.");
      return;
    }
    const source = items.find((i) => i.id === tool.sourceId);
    const id = maxItemId(useStore.getState().history) + 1;
    addItem({
      id,
      name: `${circular ? "Circular" : "Grid"} of ${source?.name ?? "object"}`,
      type: "csg",
      children: [],
      position: result.position,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      geometryData: result.geometryData,
      regenerator: {
        ...args.regenerator,
        centerOffset: result.centerOffset,
        regeneratedAt: printPrecision,
      },
    });
    useStore.getState().selectItem?.(id);
    close();
  };

  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") confirm();
    else if (e.key === "Escape") close();
  };
  const inp = (value, setter, ok, autoFocus = false) => (
    <FormulaInput
      variables={variables}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => setter(e.target.value)}
      onKeyDown={onKey}
      style={barInput(ok)}
    />
  );

  return (
    <>
      <div className="sketch-placement-hint">
        Set the {circular ? "circular" : "rectangular"} pattern options, then
        Confirm · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        {circular ? (
          <>
            <span style={LBL}>Axis</span>
            <button
              type="button"
              onClick={pickAxis}
              style={pickBtn(circularAxisPick)}
              title="Pick the rotation axis (a line or edge)"
            >
              {circularAxisPick
                ? "Click a line/edge…"
                : tool?.axis
                  ? "Axis set — re-pick"
                  : "Pick axis"}
            </button>
            <span style={LBL}>Count</span>
            {inp(count, setCount, Number.isFinite(countV) && countV >= 2, true)}
            <span style={LBL}>Angle°</span>
            {inp(angle, setAngle, Number.isFinite(angleV) && angleV > 0)}
            <span style={LBL}>Offset/360°(mm)</span>
            {inp(axialOffset, setAxialOffset, Number.isFinite(axialOffsetV))}
          </>
        ) : (
          <>
            <span style={LBL}>Count X</span>
            {inp(
              countX,
              setCountX,
              Number.isFinite(countXV) && countXV >= 1,
              true,
            )}
            <span style={LBL}>Sp X(mm)</span>
            {inp(dx, setDx, Number.isFinite(dxV))}
            <span style={LBL}>Count Y</span>
            {inp(countY, setCountY, Number.isFinite(countYV) && countYV >= 1)}
            <span style={LBL}>Sp Y(mm)</span>
            {inp(dy, setDy, Number.isFinite(dyV))}
            <span style={LBL}>Count Z</span>
            {inp(countZ, setCountZ, Number.isFinite(countZV) && countZV >= 1)}
            <span style={LBL}>Sp Z(mm)</span>
            {inp(dz, setDz, Number.isFinite(dzV))}
          </>
        )}
        <button type="button" onClick={close} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!valid}
          title={valid ? "Create the pattern" : "Enter valid values"}
          style={barBtn(true, !valid)}
        >
          Create
        </button>
      </div>
    </>
  );
};

export default Pattern3dDialog;
