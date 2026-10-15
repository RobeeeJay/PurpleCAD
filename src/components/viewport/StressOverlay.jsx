// Stress analysis: hold some faces, load others, solve, and read the field on
// the body.
//
// Two pick phases then a solve, in the bottom-bar style the other 3D Modify
// tools use.  The force is in newtons and the direction is a unit vector in the
// user's Z-up frame (see utils/axisDisplay.js), so what is typed matches what
// the transform panel shows.

import { useState } from "react";
import { useStore } from "../../store";
import { STRUCTURAL_MATERIALS } from "../../store/stressSlice.js";
import { DISPLAY_AXES } from "../../utils/axisDisplay.js";
import { BAR_STYLE, Field, barBtn, barInput, pickBtn } from "./overlayBar.js";
import { useEscapeKey } from "../inputs.jsx";

const triCount = (soup) => (soup?.length ?? 0) / 9;

export default function StressOverlay() {
  const stressTool = useStore((s) => s.stressTool);
  const stressSolving = useStore((s) => s.stressSolving);
  const stressResult = useStore((s) => s.stressResult);
  const setStressPhase = useStore((s) => s.setStressPhase);
  const setStressParams = useStore((s) => s.setStressParams);
  const cancelStressTool = useStore((s) => s.cancelStressTool);
  const clearStressFaces = useStore((s) => s.clearStressFaces);
  const theme = useStore((s) => s.theme);
  const [busy, setBusy] = useState(false);

  useEscapeKey(!!stressTool, () => cancelStressTool());
  if (!stressTool) return null;

  const { phase, itemId, fixtures, loadFaces, params } = stressTool;
  const held = triCount(fixtures);
  const loaded = triCount(loadFaces);
  const ready = held > 0 && loaded > 0 && params.forceN > 0;

  const solve = async () => {
    setBusy(true);
    // The direction is entered in the user's frame; the solver works in the
    // internal one, so it is mapped through the same table every other
    // axis-labelled input uses rather than being passed straight through.
    const [dx, dy, dz] = params.direction;
    const force = [dx, dz, -dy].map((c) => c * params.forceN);
    await useStore.getState().runStressAnalysis({
      itemId,
      fixtures,
      loads: [{ soup: loadFaces, force }],
      materialName: params.material,
      resolution: params.resolution,
      theme,
    });
    setBusy(false);
    setStressPhase("params");
  };

  const dirField = (i) => (
    <input
      type="number"
      step="1"
      value={params.direction[i]}
      style={barInput(true)}
      onChange={(e) => {
        const next = [...params.direction];
        next[i] = Number(e.target.value);
        setStressParams({ direction: next });
      }}
    />
  );

  return (
    <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
      <button
        title="Pick the faces that are HELD — bolted, clamped, or resting on something that does not move"
        style={pickBtn(phase === "fixtures")}
        onClick={() => setStressPhase("fixtures")}
      >
        Held faces: {held || "none"}
      </button>
      <button
        title="Pick the faces the force is applied to; it is spread over their area"
        style={pickBtn(phase === "loads")}
        onClick={() => setStressPhase("loads")}
      >
        Loaded faces: {loaded || "none"}
      </button>
      <Field
        label="Force (N)"
        hint="Total force over the loaded faces, in newtons"
        style={{ marginLeft: 8 }}
      >
        <input
          type="number"
          step="10"
          value={params.forceN}
          style={barInput(params.forceN > 0)}
          onChange={(e) => setStressParams({ forceN: Number(e.target.value) })}
        />
      </Field>
      <Field
        label={`Direction (${DISPLAY_AXES.map((a) => a.label).join("")})`}
        hint="Which way the force pushes; magnitude comes from the force field, so only the direction matters"
      >
        {dirField(0)}
        {dirField(1)}
        {dirField(2)}
      </Field>
      <Field
        label="Material"
        hint="Sets stiffness and the yield the colours are scaled against"
      >
        <select
          value={params.material}
          style={{ marginRight: 6 }}
          onChange={(e) => setStressParams({ material: e.target.value })}
        >
          {STRUCTURAL_MATERIALS.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Detail"
        hint="Voxels across the part's longest side. Finer resolves more, and takes longer"
      >
        <input
          type="number"
          step="8"
          min="16"
          max="96"
          value={params.resolution}
          style={barInput(params.resolution >= 16)}
          onChange={(e) =>
            setStressParams({ resolution: Number(e.target.value) })
          }
        />
      </Field>
      <button
        title="Solve the load case and colour the body"
        style={barBtn(true, !ready || busy || stressSolving)}
        disabled={!ready || busy || stressSolving}
        onClick={solve}
      >
        {busy || stressSolving
          ? "Solving…"
          : stressResult
            ? "Re-solve"
            : "Solve"}
      </button>
      <button
        title="Clear both face picks and start the load case again"
        style={barBtn(false, held === 0 && loaded === 0)}
        disabled={held === 0 && loaded === 0}
        onClick={() => {
          clearStressFaces();
          // The picked faces stay lit in the viewport otherwise: the highlight
          // is scene state, not a view of the store.
          useStore.getState()._cameraControls?.clearEmbossSelectedFaces?.();
          setStressPhase("fixtures");
        }}
      >
        Reset picks
      </button>
      <button
        title="Close the stress tool and take the colours off"
        style={barBtn(false)}
        onClick={() => {
          useStore.getState().clearStressResult();
          cancelStressTool();
        }}
      >
        Done
      </button>
    </div>
  );
}
