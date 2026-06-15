import React, { useState, useEffect } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import FormulaInput from "./FormulaInput";
import { evalValue, useDebouncedPreview } from "./inputs.jsx";
import { pattern3dItem } from "../three/occClient.js";
import { maxItemId } from "../store/internals.js";
import { MM_PER_UNIT } from "../three/sceneObjects.js";
import "../styles/VariablesDialog.css";

// Parameters for a circular or rectangular 3D pattern, with a live preview.
// Circular tiles `count` copies over `angle` about the plane's normal axis;
// rectangular tiles a countX×countY grid along the world X/Y axes.  Confirm adds
// a pattern3d regenerator item that tracks the source.
const Pattern3dDialog = () => {
  const tool = useStore((s) => s.pattern3dTool);
  const cancelPattern3d = useStore((s) => s.cancelPattern3d);
  const items = useStore((s) => s.items);
  const variables = useStore((s) => s.variables);
  const addItem = useStore((s) => s.addItem);
  const curveResolution = useStore((s) => s.curveResolution);

  const open = !!tool;
  const circular = tool?.patternType === "circular";

  const [count, setCount] = useState("4");
  const [angle, setAngle] = useState("360");
  const [countX, setCountX] = useState("3");
  const [dx, setDx] = useState("50");
  const [countY, setCountY] = useState("1");
  const [dy, setDy] = useState("50");

  useEffect(() => {
    if (open) {
      setCount("4");
      setAngle("360");
      setCountX("3");
      setDx("50");
      setCountY("1");
      setDy("50");
    }
  }, [open]);

  const countV = evalValue(count, variables);
  const angleV = evalValue(angle, variables);
  const countXV = evalValue(countX, variables);
  const dxV = evalValue(dx, variables);
  const countYV = evalValue(countY, variables);
  const dyV = evalValue(dy, variables);

  const valid = circular
    ? Number.isFinite(countV) &&
      countV >= 2 &&
      Number.isFinite(angleV) &&
      angleV > 0
    : Number.isFinite(countXV) &&
      countXV >= 1 &&
      Number.isFinite(countYV) &&
      countYV >= 1 &&
      Number.isFinite(dxV) &&
      Number.isFinite(dyV);

  const printPrecision = curveResolution === "print" ? 0.01 : null;

  // Resolve the live OCC params + the regenerator to persist.
  const build = () => {
    if (!tool || !valid) return null;
    if (circular) {
      const plane = items.find((i) => i.id === tool.planeId);
      if (!plane) return null;
      const r = plane.rotation || { x: 0, y: 0, z: 0 };
      const nv = new THREE.Vector3(0, 0, 1).applyEuler(
        new THREE.Euler(r.x || 0, r.y || 0, r.z || 0),
      );
      const angleRad = (angleV * Math.PI) / 180;
      return {
        params: {
          origin: plane.position,
          axis: { x: nv.x, y: nv.y, z: nv.z },
          count: Math.round(countV),
          angleRad,
        },
        regenerator: {
          kind: "pattern3d",
          patternType: "circular",
          sourceId: tool.sourceId,
          planeId: tool.planeId,
          count: Math.round(countV),
          angleRad,
        },
      };
    }
    const sx = dxV / MM_PER_UNIT,
      sy = dyV / MM_PER_UNIT;
    return {
      params: {
        countX: Math.round(countXV),
        countY: Math.round(countYV),
        dx: sx,
        dy: sy,
      },
      regenerator: {
        kind: "pattern3d",
        patternType: "rectangular",
        sourceId: tool.sourceId,
        countX: Math.round(countXV),
        countY: Math.round(countYV),
        dx: sx,
        dy: sy,
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
    [open, valid, countV, angleV, countXV, dxV, countYV, dyV, circular],
  );

  useEffect(() => {
    return () => useStore.getState()._cameraControls?.clearPattern3dPreview?.();
  }, [tool]);

  if (!open) return null;

  const close = () => {
    useStore.getState()._cameraControls?.clearPattern3dPreview?.();
    cancelPattern3d();
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

  const field = (ok) => ({
    background: "var(--bg-tertiary)",
    border: `1px solid ${ok ? "var(--border-color)" : "#e87575"}`,
    color: "var(--text-primary)",
    padding: "6px 8px",
    borderRadius: 3,
    fontFamily: "monospace",
    fontSize: 13,
    width: 80,
  });
  const row = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 12,
    color: "var(--text-secondary)",
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
      style={field(ok)}
    />
  );

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
          <h2>{circular ? "Circular pattern" : "Rectangular pattern"}</h2>
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
            gap: 12,
          }}
        >
          {circular ? (
            <>
              <label style={row}>
                <span>Count</span>
                {inp(
                  count,
                  setCount,
                  Number.isFinite(countV) && countV >= 2,
                  true,
                )}
              </label>
              <label style={row}>
                <span>Total angle (°)</span>
                {inp(angle, setAngle, Number.isFinite(angleV) && angleV > 0)}
              </label>
            </>
          ) : (
            <>
              <label style={row}>
                <span>Count X</span>
                {inp(
                  countX,
                  setCountX,
                  Number.isFinite(countXV) && countXV >= 1,
                  true,
                )}
              </label>
              <label style={row}>
                <span>Spacing X (mm)</span>
                {inp(dx, setDx, Number.isFinite(dxV))}
              </label>
              <label style={row}>
                <span>Count Y</span>
                {inp(
                  countY,
                  setCountY,
                  Number.isFinite(countYV) && countYV >= 1,
                )}
              </label>
              <label style={row}>
                <span>Spacing Y (mm)</span>
                {inp(dy, setDy, Number.isFinite(dyV))}
              </label>
            </>
          )}
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
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Pattern3dDialog;
