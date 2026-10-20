import { useState, useEffect } from "react";
import { useStore } from "../store";
import { activePrecision } from "../three/resolution.js";
import {
  canConvert,
  commitConvert,
  SURFACE_COLORS,
} from "../three/cameraControls/convertSurfaces.js";
import { useDebouncedPreview, useEscapeKey } from "./inputs.jsx";
import ToolErrorLine from "./ToolErrorLine.jsx";
import { BAR_STYLE, Field, barInput, barBtn } from "./viewport/overlayBar.js";

// Convert to Surfaces dialog: a mesh body rebuilt as exact faces wherever its
// triangles lie on a plane, cylinder, cone, sphere, torus, oval wall or
// smooth freeform surface, within a tolerance.  Opens fresh from the Modify
// toolbar ({ itemId }) or on a committed step from its timeline Edit
// ({ itemId, entryId }).
const DEFAULT_TOLERANCE_MM = 0.01;
// Finer than a mesh's own float precision would recognise nothing.
const MIN_TOLERANCE_MM = 0.0001;

const LABELS = [
  ["plane", "plane", "planes"],
  ["cylinder", "cylinder", "cylinders"],
  ["cone", "cone", "cones"],
  ["sphere", "sphere", "spheres"],
  ["torus", "torus", "tori"],
  ["ellipticCylinder", "oval wall", "oval walls"],
  ["bspline", "freeform", "freeform"],
];
const count = (n) => Math.round(n).toLocaleString();

// "212 faces: 30 planes, 12 cylinders, 168 triangles left"
export function convertSummary(result) {
  if (!result) return null;
  const parts = LABELS.filter(([k]) => result.counts[k]).map(
    ([k, one, many]) =>
      `${count(result.counts[k])} ${result.counts[k] === 1 ? one : many}`,
  );
  const left = result.triangleCounts.mesh;
  const faces =
    LABELS.reduce((n, [k]) => n + (result.counts[k] || 0), 0) + left;
  if (left) parts.push(`${count(left)} triangle${left === 1 ? "" : "s"} left`);
  return `${count(faces)} faces: ${parts.join(", ")}`;
}

const swatch = (hex) => `#${hex.toString(16).padStart(6, "0")}`;

const ConvertSurfacesDialog = () => {
  const target = useStore((s) => s.convertTarget);
  const setTarget = useStore((s) => s.setConvertTarget);
  const items = useStore((s) => s.items);
  const history = useStore((s) => s.history);
  const printPrecision = useStore(activePrecision);
  const updateConvertParams = useStore((s) => s.updateConvertParams);

  const isEdit = target?.entryId != null;
  const entry = isEdit ? history.find((h) => h.id === target.entryId) : null;
  const regenerator = entry?.instruction?.patches?.regenerator;
  const source = isEdit
    ? regenerator?.source
    : items.find((i) => i.id === target?.itemId);

  const [toleranceMm, setToleranceMm] = useState("");
  const [recognised, setRecognised] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!target) return;
    setRecognised(null);
    setToleranceMm(String(regenerator?.toleranceMm ?? DEFAULT_TOLERANCE_MM));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, regenerator]);

  const tol = Number(toleranceMm);
  const valid = Number.isFinite(tol) && tol >= MIN_TOLERANCE_MM;
  const params = { toleranceMm: tol };

  useDebouncedPreview(
    !!target && valid && canConvert(source),
    async () => {
      const r = await useStore
        .getState()
        ._cameraControls?.updateConvertPreview?.({
          itemId: target?.itemId,
          regenerator,
          params,
        });
      if (r) setRecognised(r);
    },
    () => {
      useStore.getState()._cameraControls?.clearConvertPreview?.();
      setRecognised(null);
    },
    [tol, target?.itemId, regenerator],
  );
  useEffect(
    () => () => useStore.getState()._cameraControls?.clearConvertPreview?.(),
    [target],
  );

  const close = () => {
    useStore.getState()._cameraControls?.clearConvertPreview?.();
    setTarget(null);
  };
  useEscapeKey(!!target, close);

  if (!target) return null;
  if (isEdit && !regenerator) return null;

  const confirm = async () => {
    if (!valid || busy) return;
    if (isEdit) {
      updateConvertParams(entry.id, params);
      close();
      return;
    }
    const item = items.find((i) => i.id === target.itemId);
    if (!canConvert(item)) return close();
    setBusy(true);
    const ok = await commitConvert({ item, params, printPrecision });
    setBusy(false);
    // A refusal has already said why on the error line, and the body is
    // still the mesh it was.
    if (ok) close();
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") confirm();
    else if (e.key === "Escape") close();
  };

  const summary = recognised
    ? convertSummary(recognised)
    : valid
      ? "Recognising…"
      : null;

  return (
    <>
      <div className="sketch-placement-hint convert-surfaces-summary">
        {summary ? `${summary} · ` : ""}Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <span
          style={{ display: "flex", gap: 6, marginRight: 10, fontSize: 11 }}
          title="What the preview's colours mean"
        >
          {LABELS.map(([k, one]) => (
            <span
              key={k}
              style={{ display: "flex", alignItems: "center", gap: 3 }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: swatch(SURFACE_COLORS[k]),
                }}
              />
              {one}
            </span>
          ))}
        </span>
        <Field
          label="Tolerance (mm)"
          hint="How far a region's triangle corners may lie from the surface it is fitted to. Larger finds more surfaces in a rough mesh; smaller keeps closer to it."
        >
          <input
            id="convert-tolerance"
            autoFocus
            value={toleranceMm}
            onChange={(e) => setToleranceMm(e.target.value)}
            onKeyDown={onKey}
            style={barInput(valid)}
          />
        </Field>
        <button type="button" onClick={close} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!valid || busy}
          title={
            valid
              ? "Rebuild the body as exact faces"
              : "Enter a valid tolerance"
          }
          style={barBtn(true, !valid || busy)}
        >
          {busy ? "Working…" : isEdit ? "Save" : "Convert"}
        </button>
      </div>
      <ToolErrorLine />
    </>
  );
};

export default ConvertSurfacesDialog;
