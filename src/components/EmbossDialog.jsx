import React, { useEffect } from "react";
import { useStore } from "../store";
import { activePrecision } from "../three/resolution.js";
import { commitEmboss } from "../three/cameraControls/emboss.js";
import { useEscapeKey, useDebouncedPreview, NumberInput } from "./inputs.jsx";
import {
  BAR_STYLE,
  LBL,
  barInput,
  barBtn,
  pickBtn,
} from "./viewport/overlayBar.js";

// Emboss tool overlay.  Pick sketch geometry + a face, then stamp it onto the
// body as a raised (emboss) or recessed (deboss) relief, with angle / offset /
// scale / depth and a projection mode.
const EmbossDialog = () => {
  const embossTool = useStore((s) => s.embossTool);
  const items = useStore((s) => s.items);
  const printPrecision = useStore(activePrecision);
  const setEmbossPicking = useStore((s) => s.setEmbossPicking);
  const updateEmbossParams = useStore((s) => s.updateEmbossParams);
  const cancelEmbossTool = useStore((s) => s.cancelEmbossTool);

  const open = !!embossTool;
  const params = embossTool?.params;
  const nProfiles = embossTool?.profiles?.length || 0;
  const hasFace = !!embossTool?.face;
  const ready = nProfiles > 0 && hasFace;

  const cancel = () => {
    useStore.getState()._cameraControls?.clearEmbossPreview?.();
    cancelEmbossTool();
  };
  useEscapeKey(open, cancel);

  // Repaint the geometry-fill selection whenever the picked set changes.
  useEffect(() => {
    useStore.getState()._cameraControls?.syncEmbossFills?.();
  }, [nProfiles]);

  useDebouncedPreview(
    ready,
    () => useStore.getState()._cameraControls?.updateEmbossPreview?.(),
    () => useStore.getState()._cameraControls?.clearEmbossPreview?.(),
    [
      ready,
      params?.deboss,
      params?.angleDeg,
      params?.offsetMm,
      params?.scale,
      params?.distanceMm,
      embossTool?.face,
      nProfiles,
    ],
  );
  useEffect(
    () => () => useStore.getState()._cameraControls?.clearEmbossPreview?.(),
    [],
  );

  if (!open) return null;

  const hint =
    embossTool.picking === "geometry"
      ? "Click sketch loops or text to stamp · click again to deselect · Esc to cancel"
      : embossTool.picking === "faces"
        ? "Click the face to emboss onto · Esc to cancel"
        : "Pick sketch geometry and a face, set the options, then Confirm · Esc to cancel";

  const confirm = async () => {
    if (!ready) return;
    const ok = await commitEmboss({ items, printPrecision });
    if (!ok)
      useStore
        .getState()
        .showNotification?.(
          "Emboss failed — check the distance/scale and that the geometry overlaps the face.",
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
          style={pickBtn(embossTool.picking === "geometry")}
          onClick={() => setEmbossPicking("geometry")}
          title="Pick sketch loops / text on one plane"
        >
          {`Geometry (${nProfiles})`}
        </button>
        <button
          type="button"
          style={{ ...pickBtn(embossTool.picking === "faces"), marginLeft: 6 }}
          onClick={() => setEmbossPicking("faces")}
          title="Pick the face to emboss onto"
        >
          {hasFace ? "Face ✓" : "Face"}
        </button>

        <span style={{ ...LBL, marginLeft: 10 }}>Mode</span>
        <button
          type="button"
          style={toggleStyle(!params.deboss)}
          onClick={() => updateEmbossParams({ deboss: false })}
        >
          Emboss
        </button>
        <button
          type="button"
          style={toggleStyle(params.deboss)}
          onClick={() => updateEmbossParams({ deboss: true })}
        >
          Deboss
        </button>

        <span style={{ ...LBL, marginLeft: 10 }}>Angle°</span>
        <NumberInput
          step="5"
          value={params.angleDeg}
          onCommit={(n) => {
            if (Number.isFinite(n)) updateEmbossParams({ angleDeg: n });
          }}
          onKeyDown={onKey}
          style={barInput(true)}
        />
        <span style={LBL}>Offset(mm)</span>
        <NumberInput
          step="0.5"
          value={params.offsetMm}
          onCommit={(n) => {
            if (Number.isFinite(n)) updateEmbossParams({ offsetMm: n });
          }}
          onKeyDown={onKey}
          style={barInput(true)}
        />
        <span style={LBL}>Scale</span>
        <NumberInput
          min="0.01"
          step="0.1"
          value={params.scale}
          onCommit={(n) => {
            if (n > 0) updateEmbossParams({ scale: n });
          }}
          onKeyDown={onKey}
          style={barInput(true)}
        />
        <span style={LBL}>Depth(mm)</span>
        <NumberInput
          min="0"
          step="0.5"
          value={params.distanceMm}
          onCommit={(n) => {
            if (n > 0) updateEmbossParams({ distanceMm: n });
          }}
          onKeyDown={onKey}
          style={barInput(true)}
        />

        <span style={{ ...LBL, marginLeft: 10 }}>Projection</span>
        <button
          type="button"
          style={toggleStyle(params.projection !== "conform")}
          onClick={() => updateEmbossParams({ projection: "center" })}
          title="Project all geometry from the centre-most face's plane"
        >
          Center
        </button>
        <button
          type="button"
          style={toggleStyle(params.projection === "conform")}
          onClick={() => updateEmbossParams({ projection: "conform" })}
          title="Wrap around the faces (cylinder / wave) — coming soon; uses Center for now"
        >
          Conform*
        </button>

        <button type="button" onClick={cancel} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!ready}
          title={ready ? "Stamp the relief" : "Pick geometry and a face first"}
          style={barBtn(true, !ready)}
        >
          Confirm
        </button>
      </div>
    </>
  );
};

export default EmbossDialog;
