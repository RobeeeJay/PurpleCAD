// Generative design: hold some faces, load others, say how much material may
// stay, and let SIMP decide where it goes.
//
// Badged EXPERIMENTAL, and meant literally: the maths is checked against
// closed-form answers, but a result is a voxel model at whatever detail was
// affordable, carries no factor of safety, and has never been put next to a
// physical test.
//
// The picks are the same as a stress case -- it is the same load case, asked a
// different question -- so the bar mirrors StressOverlay, plus a volume budget
// and a live iteration count. The result previews on the body and is only
// committed when Apply is pressed: a run takes long enough that applying one
// you have not looked at is a real loss.

import React from "react";
import { useStore } from "../../store";
import { STRUCTURAL_MATERIALS } from "../../store/stressSlice.js";
import { DISPLAY_AXES } from "../../utils/axisDisplay.js";
import { BAR_STYLE, Field, barBtn, barInput, pickBtn } from "./overlayBar.js";
import { useEscapeKey } from "../inputs.jsx";

const triCount = (soup) => (soup?.length ?? 0) / 9;

export default function OptimiseOverlay() {
  const tool = useStore((s) => s.optimiseTool);
  const progress = useStore((s) => s.optimiseProgress);
  const result = useStore((s) => s.optimiseResult);
  const setPhase = useStore((s) => s.setOptimisePhase);
  const setParams = useStore((s) => s.setOptimiseParams);
  const clearFaces = useStore((s) => s.clearOptimiseFaces);
  const cancel = useStore((s) => s.cancelOptimiseTool);
  const run = useStore((s) => s.runOptimisation);
  const stop = useStore((s) => s.stopOptimisation);
  const apply = useStore((s) => s.applyOptimisation);

  useEscapeKey(!!tool, () => cancel());
  if (!tool) return null;

  const { phase, fixtures, loadFaces, params } = tool;
  const held = triCount(fixtures);
  const loaded = triCount(loadFaces);
  const ready = held > 0 && loaded > 0 && params.forceN > 0;
  const running = !!progress;

  const dirField = (i) => (
    <input
      type="number"
      step="1"
      value={params.direction[i]}
      style={barInput(true)}
      onChange={(e) => {
        const next = [...params.direction];
        next[i] = Number(e.target.value);
        setParams({ direction: next });
      }}
    />
  );

  return (
    <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
      <span
        title="Experimental: the result is a voxel model at whatever detail was affordable, it carries no factor of safety, and none of it has been checked against a physical test. Treat the shape as a starting point to model properly, not as a part to make."
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: "#D4A33F",
          border: "1px solid #D4A33F",
          borderRadius: 3,
          padding: "2px 6px",
          marginRight: 4,
          alignSelf: "center",
        }}
      >
        Experimental
      </span>
      <button
        title="Pick the faces that are HELD — these anchor the part, and material is only kept where it connects back to them"
        style={pickBtn(phase === "fixtures")}
        onClick={() => setPhase("fixtures")}
      >
        Held faces: {held || "none"}
      </button>
      <button
        title="Pick the faces the force is applied to"
        style={pickBtn(phase === "loads")}
        onClick={() => setPhase("loads")}
      >
        Loaded faces: {loaded || "none"}
      </button>
      <Field label="Force (N)" hint="Total force over the loaded faces">
        <input
          type="number"
          step="10"
          value={params.forceN}
          style={barInput(params.forceN > 0)}
          onChange={(e) => setParams({ forceN: Number(e.target.value) })}
        />
      </Field>
      <Field
        label={`Direction (${DISPLAY_AXES.map((a) => a.label).join("")})`}
        hint="Which way the force pushes"
      >
        {dirField(0)}
        {dirField(1)}
        {dirField(2)}
      </Field>
      <Field
        label="Material"
        hint="Sets the stiffness the optimiser works with"
      >
        <select
          value={params.material}
          style={{ marginRight: 6 }}
          onChange={(e) => setParams({ material: e.target.value })}
        >
          {STRUCTURAL_MATERIALS.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Keep (%)"
        hint="How much of the body's volume may remain. Lower removes more and takes the stiffness with it"
      >
        <input
          type="number"
          step="5"
          min="5"
          max="90"
          value={Math.round(params.volumeFraction * 100)}
          style={barInput(params.volumeFraction > 0)}
          onChange={(e) =>
            setParams({
              volumeFraction: Math.min(
                0.95,
                Math.max(0.05, Number(e.target.value) / 100),
              ),
            })
          }
        />
      </Field>
      <Field
        label="Detail"
        hint="Voxels across the longest side. The result is blocky at this scale, and every step costs a full solve"
      >
        <input
          type="number"
          step="4"
          min="12"
          max="64"
          value={params.resolution}
          style={barInput(params.resolution >= 12)}
          onChange={(e) => setParams({ resolution: Number(e.target.value) })}
        />
      </Field>
      <Field
        label="Steps"
        hint="Optimisation iterations; it stops early once the shape settles"
      >
        <input
          type="number"
          step="5"
          min="5"
          max="80"
          value={params.iterations}
          style={barInput(params.iterations >= 5)}
          onChange={(e) => setParams({ iterations: Number(e.target.value) })}
        />
      </Field>
      <button
        title="Run the optimisation; the shape updates on the body after every step"
        style={barBtn(true, !ready || running)}
        disabled={!ready || running}
        onClick={run}
      >
        {running
          ? `Step ${progress.iteration}/${progress.of}…`
          : result
            ? "Re-run"
            : "Optimise"}
      </button>
      {running && (
        <>
          <span
            style={{ fontSize: 11, color: "#aaa", marginLeft: 4 }}
            title="Compliance is the work the load does: lower is stiffer. Movement is how far the densities shifted this step -- it settles toward zero."
          >
            {progress.compliance != null &&
              `stiffness ${(1 / progress.compliance).toExponential(2)}`}
            {progress.change != null &&
              ` · movement ${progress.change.toFixed(3)}`}
            {progress.kept != null &&
              progress.designElements > 0 &&
              ` · ${Math.round((progress.kept / progress.designElements) * 100)}% kept`}
          </span>
          <button
            title="Stop here and keep the shape currently on screen"
            style={barBtn(false)}
            onClick={stop}
          >
            Stop
          </button>
        </>
      )}
      {result && !running && (
        <button
          title="Keep the optimised shape as a new body, leaving the original as it was"
          style={barBtn(true)}
          onClick={apply}
        >
          Apply (
          {Math.round((result.keptElements / result.designElements) * 100)}%
          kept)
        </button>
      )}
      <button
        title="Clear both face picks and start the load case again"
        style={barBtn(false, held === 0 && loaded === 0)}
        disabled={held === 0 && loaded === 0}
        onClick={() => {
          clearFaces();
          useStore.getState()._cameraControls?.clearEmbossSelectedFaces?.();
          setPhase("fixtures");
        }}
      >
        Reset picks
      </button>
      <button
        title="Close without keeping the result"
        style={barBtn(false)}
        onClick={cancel}
      >
        Done
      </button>
    </div>
  );
}
