import { useState, useEffect } from "react";
import { useStore } from "../store";
import FormulaInput from "./FormulaInput";
import { evalValue, useDebouncedPreview, useEscapeKey } from "./inputs.jsx";
import {
  BAR_STYLE,
  Field,
  barInput,
  barBtn,
  pickBtn,
} from "./viewport/overlayBar.js";
import { pattern3dItem, withCommitGuard } from "../three/occClient.js";
import { activePrecision } from "../three/resolution.js";
import { maxItemId } from "../store/internals.js";
import { MM_PER_UNIT } from "../three/sceneObjects.js";

const SOLID_TYPES = [
  "cube",
  "sphere",
  "cylinder",
  "torus",
  "cone",
  "extrude",
  "csg",
];

// Parameters for a circular or rectangular 3D pattern, with a live preview.
// Circular tiles `count` copies over `angle` about the plane's normal axis;
// rectangular tiles a countX×countY grid along the world X/Y axes.  Confirm adds
// a pattern3d regenerator item that tracks the source.
const Pattern3dDialog = () => {
  const tool = useStore((s) => s.pattern3dTool);
  const cancelPattern3d = useStore((s) => s.cancelPattern3d);
  const updatePattern3d = useStore((s) => s.updatePattern3d);
  const setCircularAxisPick = useStore((s) => s.setCircularAxisPick);
  const circularAxisPick = useStore((s) => s.circularAxisPick);
  const selectedIds = useStore((s) => s.selectedIds);
  const setSelection = useStore((s) => s.setSelection);
  const items = useStore((s) => s.items);
  const variables = useStore((s) => s.variables);
  const addItem = useStore((s) => s.addItem);
  const printPrecision = useStore(activePrecision);

  const open = !!tool;
  const circular = tool?.patternType === "circular";

  // Object-pick phase: true while a click in the view should choose the source
  // object to pattern.  Auto-armed when the tool opens with nothing picked.
  const [pickSource, setPickSource] = useState(false);
  useEffect(() => {
    if (open) setPickSource(!tool?.sourceId);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Capture the picked solid as the pattern source, then leave pick mode.
  useEffect(() => {
    if (!open || !pickSource) return;
    const src = selectedIds
      .map((id) => items.find((i) => i.id === id))
      .find((i) => i && SOLID_TYPES.includes(i.type));
    if (src) {
      updatePattern3d({ sourceId: src.id });
      setPickSource(false);
    }
  }, [selectedIds, pickSource, open, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const sourceName = items.find((i) => i.id === tool?.sourceId)?.name;

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

  const valid =
    !!tool?.sourceId &&
    (circular
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
        Number.isFinite(dzV));

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
    // Fields are in the Z-up display frame; the grid vector is internal
    // (user X,Y,Z = internal x,−z,y), so the "Y" column drives internal −z
    // and the "Z" column internal y.
    const grid = {
      countX: Math.round(countXV),
      countY: Math.round(countZV),
      countZ: Math.round(countYV),
      dx: dxV / MM_PER_UNIT,
      dy: dzV / MM_PER_UNIT,
      dz: -dyV / MM_PER_UNIT,
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
      // Dropped if the dialog closes, or a newer preview starts, first.
      const token = cc?.beginToolPreview?.();
      try {
        const result = await pattern3dItem({
          patternType: tool.patternType,
          sourceId: tool.sourceId,
          params: args.params,
          allItems: items,
          printPrecision,
        });
        cc?.previewPattern3d?.(result, token);
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

  const close = () => {
    const cc = useStore.getState()._cameraControls;
    cc?.clearPattern3dPreview?.();
    cc?.clearCircularAxisHighlight?.();
    cancelPattern3d();
  };
  useEscapeKey(open, close);

  if (!open) return null;

  const pickObject = () => {
    useStore.getState()._cameraControls?.clearPattern3dPreview?.();
    setCircularAxisPick(false); // mutually exclusive with axis picking
    setPickSource(true);
    setSelection(tool?.sourceId != null ? [tool.sourceId] : []);
  };
  const pickAxis = () => {
    useStore.getState()._cameraControls?.clearPattern3dPreview?.();
    setPickSource(false); // mutually exclusive with source picking
    setCircularAxisPick(true);
  };
  const confirm = async () => {
    const args = build();
    if (!args) return;
    let result;
    try {
      // Guarded like the other previewing tools: a superseding preview calls
      // cancelOcc, which would abort this commit and hand back nothing.
      result = await withCommitGuard(() =>
        pattern3dItem({
          patternType: tool.patternType,
          sourceId: tool.sourceId,
          params: args.params,
          allItems: items,
          printPrecision,
        }),
      );
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
        {pickSource
          ? "Click the object to pattern in the view"
          : `Set the ${circular ? "circular" : "rectangular"} pattern options, then Confirm`}{" "}
        · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <Field
          label="Object"
          hint="Which body gets repeated. Re-picking swaps the pattern onto a different object."
        >
          <button
            type="button"
            onClick={pickObject}
            style={pickBtn(pickSource)}
            title="Pick the object to pattern"
          >
            {pickSource ? "Click an object…" : (sourceName ?? "Pick object")}
          </button>
        </Field>
        {circular ? (
          <>
            <Field
              label="Axis"
              hint="Line or edge the copies rotate around. Picking a different axis swings the whole ring elsewhere."
            >
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
            </Field>
            <Field
              label="Count"
              hint="Total number of copies including the original. More copies spread over the same angle, so they sit closer together."
            >
              {inp(
                count,
                setCount,
                Number.isFinite(countV) && countV >= 2,
                true,
              )}
            </Field>
            <Field
              label="Angle°"
              hint="Angle the copies are spread over. 360 closes the ring; less makes a partial arc."
            >
              {inp(angle, setAngle, Number.isFinite(angleV) && angleV > 0)}
            </Field>
            <Field
              label="Offset/360°(mm)"
              hint="Rise along the axis per full turn. Non-zero turns the ring into a helix, like a spiral staircase."
            >
              {inp(axialOffset, setAxialOffset, Number.isFinite(axialOffsetV))}
            </Field>
          </>
        ) : (
          <>
            <Field
              label="Count X"
              hint="Number of copies along the display X axis, counting the original. 1 means no repeat in X."
            >
              {inp(
                countX,
                setCountX,
                Number.isFinite(countXV) && countXV >= 1,
                true,
              )}
            </Field>
            <Field
              label="Sp X(mm)"
              hint="Gap between copy centres along X. Negative repeats the other way; smaller than the body makes the copies overlap."
            >
              {inp(dx, setDx, Number.isFinite(dxV))}
            </Field>
            <Field
              label="Count Y"
              hint="Number of copies along the display Y axis, counting the original."
            >
              {inp(countY, setCountY, Number.isFinite(countYV) && countYV >= 1)}
            </Field>
            <Field
              label="Sp Y(mm)"
              hint="Gap between copy centres along Y. Negative repeats the other way."
            >
              {inp(dy, setDy, Number.isFinite(dyV))}
            </Field>
            <Field
              label="Count Z"
              hint="Number of copies along the display Z axis (up), counting the original."
            >
              {inp(countZ, setCountZ, Number.isFinite(countZV) && countZV >= 1)}
            </Field>
            <Field
              label="Sp Z(mm)"
              hint="Gap between copy centres along Z. Negative stacks them downwards."
            >
              {inp(dz, setDz, Number.isFinite(dzV))}
            </Field>
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
