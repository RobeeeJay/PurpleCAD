import { useState, useEffect } from "react";
import { useStore } from "../store";
import { activePrecision } from "../three/resolution.js";
import {
  canSimplify,
  commitSimplify,
} from "../three/cameraControls/simplify.js";
import { useDebouncedPreview, useEscapeKey } from "./inputs.jsx";
import ToolErrorLine from "./ToolErrorLine.jsx";
import {
  BAR_STYLE,
  Field,
  barInput,
  barBtn,
  toggleBtn,
} from "./viewport/overlayBar.js";

// Simplify dialog: fewer triangles for a mesh body, either held within a
// deviation from the original or cut to a triangle count.  Opens fresh from
// the Modify toolbar ({ itemId }) or on a committed step from its timeline
// Edit ({ itemId, entryId }).  A fresh target may carry a `preset` of the
// dialog's values.
const DEFAULT_TOLERANCE_MM = 0.05;
// The finest deviation offered: below it meshoptimizer's own estimate stops
// the reduction before anything useful happens.
const MIN_TOLERANCE_MM = 0.001;

const triangleCount = (g) =>
  g?.indices?.length ? g.indices.length / 3 : (g?.positions?.length ?? 0) / 9;
const count = (n) => Math.round(n).toLocaleString();

const SimplifyDialog = () => {
  const target = useStore((s) => s.simplifyTarget);
  const setTarget = useStore((s) => s.setSimplifyTarget);
  const items = useStore((s) => s.items);
  const history = useStore((s) => s.history);
  const printPrecision = useStore(activePrecision);
  const updateSimplifyParams = useStore((s) => s.updateSimplifyParams);

  const isEdit = target?.entryId != null;
  const entry = isEdit ? history.find((h) => h.id === target.entryId) : null;
  const regenerator = entry?.instruction?.patches?.regenerator;
  const source = isEdit
    ? regenerator?.source
    : items.find((i) => i.id === target?.itemId);
  const sourceTris = triangleCount(source?.geometryData);

  const [mode, setMode] = useState("deviation");
  const [toleranceMm, setToleranceMm] = useState("");
  const [triangles, setTriangles] = useState("");
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!target) return;
    setStats(null);
    // A committed step's own values, else a preset from whoever opened it
    // (Simplify to fit), else the defaults.
    const seed = regenerator ?? target.preset ?? {};
    setMode(seed.mode ?? "deviation");
    setToleranceMm(String(seed.toleranceMm ?? DEFAULT_TOLERANCE_MM));
    setTriangles(String(seed.targetTriangles ?? Math.round(sourceTris / 2)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, regenerator]);

  const tol = Number(toleranceMm);
  const tris = Math.round(Number(triangles));
  const valid =
    mode === "deviation"
      ? Number.isFinite(tol) && tol >= MIN_TOLERANCE_MM
      : Number.isFinite(tris) && tris >= 4;
  const params = { mode, toleranceMm: tol, targetTriangles: tris };

  useDebouncedPreview(
    !!target && valid && canSimplify(source),
    async () => {
      const s = await useStore
        .getState()
        ._cameraControls?.updateSimplifyPreview?.({
          itemId: target?.itemId,
          regenerator,
          params,
        });
      if (s) setStats(s);
    },
    () => {
      useStore.getState()._cameraControls?.clearSimplifyPreview?.();
      setStats(null);
    },
    [mode, tol, tris, target?.itemId, regenerator],
  );
  useEffect(
    () => () => useStore.getState()._cameraControls?.clearSimplifyPreview?.(),
    [target],
  );

  const close = () => {
    useStore.getState()._cameraControls?.clearSimplifyPreview?.();
    setTarget(null);
  };
  useEscapeKey(!!target, close);

  if (!target) return null;
  if (isEdit && !regenerator) return null;

  const confirm = async () => {
    if (!valid || busy) return;
    if (isEdit) {
      updateSimplifyParams(entry.id, params);
      close();
      return;
    }
    const item = items.find((i) => i.id === target.itemId);
    if (!canSimplify(item)) return close();
    setBusy(true);
    const ok = await commitSimplify({ item, params, printPrecision });
    setBusy(false);
    // A failure has already said why on the error line.
    if (ok) close();
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") confirm();
    else if (e.key === "Escape") close();
  };

  // Both figures are measured bounds: no point of the result is further from
  // the original than this, and no point of the original further from it.
  const summary = stats
    ? `${count(stats.trianglesBefore)} → ${count(stats.trianglesAfter)} triangles, within ${stats.maxDeviationMm.toFixed(3)} mm`
    : valid
      ? "Measuring…"
      : null;

  return (
    <>
      <div className="sketch-placement-hint">
        {summary ? `${summary} · ` : ""}Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <button
          type="button"
          style={{ ...toggleBtn(mode === "deviation"), marginRight: 4 }}
          onClick={() => setMode("deviation")}
          title="Remove as many triangles as possible while staying within a distance of the original surface"
        >
          Deviation
        </button>
        <button
          type="button"
          style={{ ...toggleBtn(mode === "triangles"), marginRight: 10 }}
          onClick={() => setMode("triangles")}
          title="Cut to a number of triangles, however far that moves the surface"
        >
          Triangle count
        </button>
        {mode === "deviation" ? (
          <Field
            label="Max deviation (mm)"
            hint={`How far the simplified surface may lie from the original, anywhere on it. Smaller keeps more detail and more triangles. At least ${MIN_TOLERANCE_MM} mm.`}
          >
            <input
              id="simplify-tolerance"
              autoFocus
              value={toleranceMm}
              onChange={(e) => setToleranceMm(e.target.value)}
              onKeyDown={onKey}
              style={barInput(valid)}
            />
          </Field>
        ) : (
          <Field
            label="Triangles"
            hint={`How many triangles to keep, of ${count(sourceTris)}. The result says how far that moved the surface.`}
          >
            <input
              id="simplify-triangles"
              autoFocus
              value={triangles}
              onChange={(e) => setTriangles(e.target.value)}
              onKeyDown={onKey}
              style={{ ...barInput(valid), width: 72 }}
            />
          </Field>
        )}
        <button type="button" onClick={close} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!valid || busy}
          title={valid ? "Apply the simplify" : "Enter a valid value"}
          style={barBtn(true, !valid || busy)}
        >
          {busy ? "Working…" : isEdit ? "Save" : "Simplify"}
        </button>
      </div>
      <ToolErrorLine />
    </>
  );
};

export default SimplifyDialog;
