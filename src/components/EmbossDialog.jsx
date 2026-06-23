import React, { useEffect } from "react";
import { useStore } from "../store";
import { activePrecision } from "../three/resolution.js";
import { commitEmboss } from "../three/cameraControls/emboss.js";
import { useEscapeKey, useDebouncedPreview, NumberInput } from "./inputs.jsx";
import ToolErrorLine from "./ToolErrorLine.jsx";
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
  const facesValid = !!embossTool?.facesValid;
  const ready = nProfiles > 0 && hasFace && facesValid;

  const cancel = () => {
    useStore.getState()._cameraControls?.clearEmbossPreview?.();
    useStore.getState()._cameraControls?.clearEmbossSelectedFaces?.();
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
      params?.offsetVMm,
      params?.scale,
      params?.distanceMm,
      params?.projection,
      params?.mirrorH,
      params?.mirrorV,
      embossTool?.face,
      embossTool?.faceSet,
      nProfiles,
      // Re-run when the body or any sketch changes size so the preview tracks a
      // resize (the commit always rebuilds from the live items).
      items,
    ],
  );
  useEffect(
    () => () => {
      useStore.getState()._cameraControls?.clearEmbossPreview?.();
      useStore.getState()._cameraControls?.clearEmbossSelectedFaces?.();
    },
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
    // A failure sets toolError (the OCC message), shown by the error line below.
    await commitEmboss({ items, printPrecision });
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
          title="Pick one or more connected faces to emboss onto (click again to deselect)"
        >
          {!hasFace ? "Faces" : facesValid ? "Faces ✓" : "Faces ⚠"}
        </button>

        <button
          type="button"
          style={{ ...toggleStyle(params.deboss), marginLeft: 10 }}
          onClick={() => updateEmbossParams({ deboss: !params.deboss })}
          title="On recesses the geometry (deboss); off raises it (emboss)"
        >
          Deboss
        </button>

        <span style={{ ...LBL, marginLeft: 10 }}>Mirror</span>
        <button
          type="button"
          style={toggleStyle(!!params.mirrorH)}
          onClick={() => updateEmbossParams({ mirrorH: !params.mirrorH })}
          title="Flip the geometry left-to-right"
        >
          Horizontal
        </button>
        <button
          type="button"
          style={toggleStyle(!!params.mirrorV)}
          onClick={() => updateEmbossParams({ mirrorV: !params.mirrorV })}
          title="Flip the geometry top-to-bottom"
        >
          Vertical
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
        <span style={LBL}>Offset H(mm)</span>
        <NumberInput
          step="0.5"
          value={params.offsetMm}
          onCommit={(n) => {
            if (Number.isFinite(n)) updateEmbossParams({ offsetMm: n });
          }}
          onKeyDown={onKey}
          style={barInput(true)}
        />
        <span style={LBL}>Offset V(mm)</span>
        <NumberInput
          step="0.5"
          value={params.offsetVMm}
          onCommit={(n) => {
            if (Number.isFinite(n)) updateEmbossParams({ offsetVMm: n });
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

        <button
          type="button"
          style={{
            ...toggleStyle(params.projection === "conform"),
            marginLeft: 10,
          }}
          onClick={() =>
            updateEmbossParams({
              projection:
                params.projection === "conform" ? "center" : "conform",
            })
          }
          title="On wraps the geometry around a cylindrical face (conform, falls back to flat on a flat face); off projects from the centre-most face's plane (center)"
        >
          Conform
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
      <ToolErrorLine />
    </>
  );
};

export default EmbossDialog;
