import React, { useEffect } from "react";
import { useStore } from "../store";
import { activePrecision } from "../three/resolution.js";
import { commitDraft } from "../three/cameraControls/draft.js";
import { useEscapeKey, useDebouncedPreview, NumberInput } from "./inputs.jsx";
import {
  BAR_STYLE,
  LBL,
  barInput,
  barBtn,
  pickBtn,
} from "./viewport/overlayBar.js";

// Draft tool overlay.  Pick the main (neutral) face, pick the connected faces to
// taper, set the angle and flip direction, then Confirm.
const DraftDialog = () => {
  const draftTool = useStore((s) => s.draftTool);
  const items = useStore((s) => s.items);
  const printPrecision = useStore(activePrecision);
  const setDraftPicking = useStore((s) => s.setDraftPicking);
  const updateDraftParams = useStore((s) => s.updateDraftParams);
  const cancelDraftTool = useStore((s) => s.cancelDraftTool);

  const open = !!draftTool;
  const hasMain = !!draftTool?.neutral;
  const nFaces = draftTool?.faces?.length || 0;
  const ready = hasMain && nFaces > 0;

  const cancel = () => {
    useStore.getState()._cameraControls?.clearDraftPreview?.();
    cancelDraftTool();
  };
  useEscapeKey(open, cancel);

  useDebouncedPreview(
    ready,
    () => useStore.getState()._cameraControls?.updateDraftPreview?.(),
    () => useStore.getState()._cameraControls?.clearDraftPreview?.(),
    [ready, draftTool?.angleDeg, draftTool?.flip, hasMain, nFaces, items],
  );
  useEffect(
    () => () => useStore.getState()._cameraControls?.clearDraftPreview?.(),
    [],
  );

  if (!open) return null;

  const hint =
    draftTool.picking === "main"
      ? "Click the main face — its plane stays fixed and the draft pivots about it · Esc to cancel"
      : draftTool.picking === "faces"
        ? "Click the faces to taper · click again to deselect · Esc to cancel"
        : "Pick the main face and the faces to taper, set the angle, then Confirm · Esc to cancel";

  const confirm = async () => {
    if (!ready) return;
    const ok = await commitDraft({ items, printPrecision });
    if (!ok)
      useStore
        .getState()
        .showNotification?.(
          "Draft failed — try a smaller angle, or faces that meet the main face.",
        );
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") confirm();
    else if (e.key === "Escape") cancel();
  };

  const toggleStyle = (on) => ({
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 3,
    border: `1px solid ${on ? "#44aaff" : "var(--border-color)"}`,
    background: on ? "rgba(68,170,255,0.18)" : "var(--bg-tertiary)",
    color: "var(--text-primary)",
    cursor: "pointer",
    marginRight: 4,
  });

  return (
    <>
      <div className="sketch-placement-hint">{hint}</div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <button
          type="button"
          style={pickBtn(draftTool.picking === "main")}
          onClick={() => setDraftPicking("main")}
          title="Pick the main (neutral) face"
        >
          {hasMain ? "Main face ✓" : "Main face"}
        </button>
        <button
          type="button"
          style={{ ...pickBtn(draftTool.picking === "faces"), marginLeft: 6 }}
          onClick={() => setDraftPicking("faces")}
          title="Pick the faces to taper (click again to deselect)"
        >
          {`Faces (${nFaces})`}
        </button>

        <span style={{ ...LBL, marginLeft: 10 }}>Angle°</span>
        <NumberInput
          step="1"
          value={draftTool.angleDeg}
          onCommit={(n) => {
            if (Number.isFinite(n)) updateDraftParams({ angleDeg: n });
          }}
          onKeyDown={onKey}
          style={barInput(true)}
        />
        <button
          type="button"
          style={{ ...toggleStyle(draftTool.flip), marginLeft: 10 }}
          onClick={() => updateDraftParams({ flip: !draftTool.flip })}
          title="Flip the draft direction"
        >
          Flip
        </button>

        <button type="button" onClick={cancel} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!ready}
          title={
            ready ? "Apply the draft" : "Pick the main face and faces first"
          }
          style={barBtn(true, !ready)}
        >
          Confirm
        </button>
      </div>
    </>
  );
};

export default DraftDialog;
