import { useState, useEffect } from "react";
import { useStore } from "../store";
import { MM_PER_UNIT } from "../three/sceneObjects.js";
import { activePrecision } from "../three/resolution.js";
import { commitShell } from "../three/cameraControls/shell.js";
import FormulaInput from "./FormulaInput";
import { evalValue, useDebouncedPreview, useEscapeKey } from "./inputs.jsx";
import {
  BAR_STYLE,
  Field,
  barInput,
  barBtn,
  pickBtn,
} from "./viewport/overlayBar.js";
import ToolErrorLine from "./ToolErrorLine.jsx";

// Shell tool dialog: hollow the selected body to a wall of `thickness`, closed
// or open at the faces picked here.  Opens fresh from the Modify toolbar
// ({ itemId }) or to edit a committed shell from its timeline step
// ({ itemId, entryId }).  The field accepts variable formulas and may be
// cleared while typing.
const DEFAULT_THICKNESS_MM = 2;

const ShellDialog = () => {
  const target = useStore((s) => s.shellTarget);
  const setTarget = useStore((s) => s.setShellTarget);
  const items = useStore((s) => s.items);
  const history = useStore((s) => s.history);
  const variables = useStore((s) => s.variables);
  const printPrecision = useStore(activePrecision);
  const updateShellParams = useStore((s) => s.updateShellParams);
  const setPicking = useStore((s) => s.setShellPicking);
  const clearOpenFaces = useStore((s) => s.clearShellOpenFaces);
  const openFaces = target?.openFaces ?? [];

  const isEdit = target?.entryId != null;
  const entry = isEdit ? history.find((h) => h.id === target.entryId) : null;
  const regenerator = entry?.instruction?.patches?.regenerator;

  const [thicknessMm, setThicknessMm] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!target) return;
    if (regenerator)
      setThicknessMm(((regenerator.thickness ?? 0) * MM_PER_UNIT).toString());
    else setThicknessMm(String(DEFAULT_THICKNESS_MM));
  }, [target, regenerator]);

  const thickVal = evalValue(thicknessMm, variables);
  const valid = Number.isFinite(thickVal) && thickVal > 0;

  // Live preview: ghost the body and overlay the hollowed result, debounced and
  // cleared the moment the thickness goes blank/invalid or the dialog closes.
  useDebouncedPreview(
    !!target && valid,
    () =>
      useStore.getState()._cameraControls?.updateShellPreview?.({
        itemId: target?.itemId,
        regenerator,
        thicknessMm: thickVal,
        openFaces,
      }),
    () => useStore.getState()._cameraControls?.clearShellPreview?.(),
    [thickVal, target?.itemId, regenerator, openFaces],
  );
  useEffect(() => {
    return () => useStore.getState()._cameraControls?.clearShellPreview?.();
  }, [target]);

  const close = () => {
    useStore.getState()._cameraControls?.clearShellPreview?.();
    setTarget(null);
  };
  useEscapeKey(!!target, close);

  if (!target) return null;
  if (isEdit && !regenerator) return null;

  const confirm = async () => {
    if (!valid || busy) return;
    if (isEdit) {
      updateShellParams(entry.id, {
        thickness: thickVal / MM_PER_UNIT,
        openFaces,
      });
      close();
      return;
    }
    const item = items.find((i) => i.id === target.itemId);
    if (!item) return close();
    setBusy(true);
    const ok = await commitShell({
      item,
      items,
      thicknessMm: thickVal,
      openFaces,
      printPrecision,
    });
    setBusy(false);
    if (!ok) {
      // A cancelled op returns no result — that's not a failure to report.
      if (!useStore.getState().operationCancelled)
        useStore
          .getState()
          .showNotification?.(
            openFaces.length
              ? "Shell failed — try a thinner wall, or a different face to leave open."
              : "Shell failed — the wall thickness is too large for this body.",
          );
      return;
    }
    close();
  };

  return (
    <>
      <div className="sketch-placement-hint">
        {target.picking
          ? "Click faces of the body to leave open (click again to close one) · Esc to cancel"
          : `${isEdit ? "Edit the shell" : "Set the wall thickness"}, pick any faces to leave open, then Confirm · Esc to cancel`}
      </div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <Field
          label="Wall thickness (mm)"
          hint="Wall left behind after the inside is hollowed out. Thicker walls leave a smaller cavity; too thick for the body and the shell fails."
        >
          <FormulaInput
            variables={variables}
            autoFocus
            value={thicknessMm}
            onChange={(e) => setThicknessMm(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") confirm();
              else if (e.key === "Escape") close();
            }}
            style={barInput(valid)}
          />
        </Field>
        <button
          type="button"
          className="shell-pick-faces"
          style={{ ...pickBtn(target.picking), marginLeft: 10 }}
          onClick={() => setPicking(!target.picking)}
          title="Pick faces to remove, leaving the shell open there"
        >
          {`Open faces (${openFaces.length})`}
        </button>
        {openFaces.length > 0 && (
          <button
            type="button"
            onClick={clearOpenFaces}
            title="Close every face again"
            style={barBtn()}
          >
            Clear
          </button>
        )}
        <button type="button" onClick={close} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!valid || busy}
          title={valid ? "Apply the shell" : "Enter a valid thickness"}
          style={barBtn(true, !valid || busy)}
        >
          {busy ? "Working…" : isEdit ? "Save" : "Shell"}
        </button>
      </div>
      <ToolErrorLine />
    </>
  );
};

export default ShellDialog;
