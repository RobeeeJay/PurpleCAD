import React, { useEffect } from "react";
import { useStore } from "../store";
import { activePrecision } from "../three/resolution.js";
import { commitHole } from "../three/cameraControls/hole.js";
import { METRIC_THREADS, threadById } from "../three/metricThreads.js";
import { useEscapeKey, useDebouncedPreview, NumberInput } from "./inputs.jsx";
import { BAR_STYLE, Field, barInput, barBtn } from "./viewport/overlayBar.js";

// Hole tool overlay.  Per-phase hint while picking the face then the centre
// point; once both are set, the bottom bar offers length / metric thread /
// diameter / tolerance with a live preview and Confirm.
const selectStyle = {
  fontSize: 11,
  height: 24,
  borderRadius: 3,
  border: "1px solid var(--border-color)",
  background: "var(--bg-tertiary)",
  color: "var(--text-primary)",
  marginRight: 6,
};

const HoleDialog = () => {
  const holeTool = useStore((s) => s.holeTool);
  const items = useStore((s) => s.items);
  const printPrecision = useStore(activePrecision);
  const updateHoleParams = useStore((s) => s.updateHoleParams);
  const cancelHoleTool = useStore((s) => s.cancelHoleTool);

  const open = !!holeTool;
  const params = holeTool?.params;
  const ready = holeTool?.phase === "params";

  const cancel = () => {
    useStore.getState()._cameraControls?.clearHolePreview?.();
    cancelHoleTool();
  };
  useEscapeKey(open, cancel);

  // Live preview once a face + point are picked and the bar is showing.
  useDebouncedPreview(
    ready,
    () => useStore.getState()._cameraControls?.updateHolePreview?.(),
    () => useStore.getState()._cameraControls?.clearHolePreview?.(),
    [
      ready,
      params?.lengthMm,
      params?.diameterMm,
      params?.pitchMm,
      params?.toleranceMm,
      params?.threaded,
      holeTool?.point,
    ],
  );
  useEffect(
    () => () => useStore.getState()._cameraControls?.clearHolePreview?.(),
    [holeTool?.itemId],
  );

  if (!open) return null;
  if (holeTool.phase === "face")
    return (
      <div className="sketch-placement-hint">
        Click a face to drill the hole into · Esc to cancel
      </div>
    );
  if (holeTool.phase === "point")
    return (
      <div className="sketch-placement-hint">
        Click a vertex, or a point on the face, for the hole centre · Esc to
        cancel
      </div>
    );

  const setThread = (e) => {
    const id = e.target.value;
    if (id === "none")
      updateHoleParams({ threadType: "none", threaded: false, pitchMm: 0 });
    else {
      const t = threadById(id);
      if (t)
        updateHoleParams({
          threadType: id,
          threaded: true,
          diameterMm: t.diameter,
          pitchMm: t.pitch,
        });
    }
  };
  const valid = params.lengthMm > 0 && params.diameterMm > 0;
  const confirm = async () => {
    if (!valid) return;
    const ok = await commitHole({ items, printPrecision });
    if (!ok)
      useStore
        .getState()
        .showNotification?.(
          "Hole failed — check the diameter/length and the point position.",
        );
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") confirm();
    else if (e.key === "Escape") cancel();
  };

  return (
    <>
      <div className="sketch-placement-hint">
        Set the hole options, then Confirm · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <Field
          label="Length(mm)"
          hint="How deep the hole is cut into the body. Longer than the wall it passes through makes it a through hole."
        >
          <NumberInput
            min="0"
            step="0.5"
            value={params.lengthMm}
            onCommit={(n) => {
              if (n > 0) updateHoleParams({ lengthMm: n });
            }}
            onKeyDown={onKey}
            style={barInput(true)}
          />
        </Field>
        <Field
          label="Thread"
          hint="Cuts a metric thread of this size instead of a plain bore. Picking one sets the diameter to that thread's tapping size."
        >
          <select
            value={params.threadType}
            onChange={setThread}
            style={selectStyle}
          >
            <option value="none">None</option>
            {METRIC_THREADS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={"Ø(mm)"}
          hint="Diameter of the bore. Locked while a thread is selected, since the thread decides it."
        >
          <NumberInput
            min="0"
            step="0.5"
            value={params.diameterMm}
            disabled={params.threaded}
            onCommit={(n) => {
              if (n > 0) updateHoleParams({ diameterMm: n });
            }}
            onKeyDown={onKey}
            style={barInput(true)}
            title={
              params.threaded ? "Set by the selected thread" : "Hole diameter"
            }
          />
        </Field>
        <Field
          label="Tol(mm)"
          hint="Clearance added to the diameter, for print or machining fit. Larger means a looser hole; negative makes it tighter."
        >
          <NumberInput
            step="0.05"
            value={params.toleranceMm}
            onCommit={(n) => {
              if (Number.isFinite(n)) updateHoleParams({ toleranceMm: n });
            }}
            onKeyDown={onKey}
            style={barInput(true)}
          />
        </Field>
        <button type="button" onClick={cancel} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!valid}
          title={valid ? "Cut the hole" : "Enter a length and diameter"}
          style={barBtn(true, !valid)}
        >
          Confirm
        </button>
      </div>
    </>
  );
};

export default HoleDialog;
