import { useEffect, useState } from "react";
import { useStore } from "../store";
import {
  DEFAULT_MATERIAL,
  BUILTIN_MATERIAL_PRESETS,
} from "../three/materialPresets.js";
import { NumberInput } from "./inputs.jsx";
import "../styles/VariablesDialog.css";

const rowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "8px 0",
};
const labelStyle = {
  display: "flex",
  flexDirection: "column",
  fontSize: 12,
  color: "var(--text-secondary)",
};
const numStyle = {
  width: 56,
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-color)",
  color: "var(--text-primary)",
  padding: "4px 6px",
  borderRadius: 3,
  fontFamily: "monospace",
  fontSize: 13,
  textAlign: "right",
};

// Object/Default material editor — color, transparency, and the standard PBR
// finish knobs the smooth renderer (renderMode.js's MeshPhysicalMaterial
// path) understands. Edits preview instantly via _cameraControls.previewMaterial
// (mutates live mesh materials, no store write); Apply commits to either
// item.material (per-object, undoable via modifyItem) or the persisted
// defaultMaterial used by future objects.
const MaterialDialog = () => {
  const target = useStore((s) => s.materialDialogTarget);
  const setTarget = useStore((s) => s.setMaterialDialogTarget);
  const items = useStore((s) => s.items);
  const defaultMaterial = useStore((s) => s.defaultMaterial);
  const setDefaultMaterial = useStore((s) => s.setDefaultMaterial);
  const setItemMaterial = useStore((s) => s.setItemMaterial);
  const materialPresets = useStore((s) => s.materialPresets);
  const addMaterialPreset = useStore((s) => s.addMaterialPreset);
  const removeMaterialPreset = useStore((s) => s.removeMaterialPreset);

  const item = target !== "default" ? items.find((i) => i.id === target) : null;
  const isDefault = target === "default";
  const renderMode = useStore((s) => s.renderMode);

  const [draft, setDraft] = useState(DEFAULT_MATERIAL);
  const [presetName, setPresetName] = useState("");
  const [ignorePresetColor, setIgnorePresetColor] = useState(false);

  useEffect(() => {
    if (target == null) return;
    const base = isDefault
      ? defaultMaterial
      : (item?.material ?? defaultMaterial);
    setDraft({ ...DEFAULT_MATERIAL, ...base });
    // Only re-seed when the dialog target changes — not on every store update,
    // which would clobber in-progress edits as the live preview runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Clear the live preview if the dialog is closed by any path (Cancel,
  // Escape, selection change, unmount).
  useEffect(() => {
    return () => {
      if (target != null)
        useStore.getState()._cameraControls?.restoreMaterialPreview?.(target);
    };
  }, [target]);

  if (target == null || (!isDefault && !item)) return null;

  const update = (patch) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    useStore.getState()._cameraControls?.previewMaterial?.(target, next);
  };

  const close = () => {
    useStore.getState()._cameraControls?.restoreMaterialPreview?.(target);
    setTarget(null);
  };

  const apply = () => {
    if (isDefault) setDefaultMaterial(draft);
    else setItemMaterial(target, draft);
    setTarget(null);
  };

  const applyPreset = (material) => {
    if (ignorePresetColor) {
      const { color, ...rest } = material;
      update(rest);
    } else {
      update(material);
    }
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    addMaterialPreset(name, draft);
    setPresetName("");
  };

  const stop = (e) => e.stopPropagation();

  return (
    <div className="variables-dialog-backdrop" onClick={close}>
      <div
        className="variables-dialog"
        style={{ minWidth: 380 }}
        onClick={stop}
      >
        <div className="variables-dialog-header">
          <h2>{isDefault ? "Default Material" : `Material — ${item.name}`}</h2>
          <button
            className="variables-dialog-close"
            onClick={close}
            title="Close"
          >
            ×
          </button>
        </div>
        <div style={{ padding: 16 }}>
          {renderMode !== "smooth" && (
            <div
              style={{
                fontSize: 11,
                color: "var(--text-secondary)",
                background: "var(--bg-tertiary)",
                borderRadius: 3,
                padding: "6px 8px",
                marginBottom: 8,
              }}
            >
              Metalness and specular reflections only render in Smooth mode —
              the current render mode shows color and transparency only.
            </div>
          )}
          <div
            style={rowStyle}
            title="Base colour of the surface. Purely visual -- it changes nothing about the geometry or an export's dimensions."
          >
            <span style={labelStyle}>Color</span>
            <input
              type="color"
              value={draft.color}
              onChange={(e) => update({ color: e.target.value })}
              style={{
                width: 48,
                height: 28,
                padding: 0,
                border: "none",
                background: "none",
              }}
            />
          </div>

          <div
            style={rowStyle}
            title="How solid the surface looks. Below 1 you can see through the body to what is behind it, which helps when checking internal features."
          >
            <span style={labelStyle}>
              <span>Opacity</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                below 1 = transparent
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={draft.opacity}
                onChange={(e) =>
                  update({ opacity: parseFloat(e.target.value) })
                }
                onKeyDown={stop}
              />
              <NumberInput
                min="0"
                max="1"
                step="0.01"
                value={draft.opacity}
                onCommit={(n) => {
                  if (Number.isFinite(n)) update({ opacity: n });
                }}
                onKeyDown={stop}
                style={numStyle}
              />
            </span>
          </div>

          <div
            style={rowStyle}
            title="How metallic the surface reads. 1 gives a mirror-like metal that takes its colour from reflections; 0 a plain dielectric. Smooth render mode only."
          >
            <span style={labelStyle}>Metalness</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={draft.metalness}
                onChange={(e) =>
                  update({ metalness: parseFloat(e.target.value) })
                }
                onKeyDown={stop}
              />
              <NumberInput
                min="0"
                max="1"
                step="0.01"
                value={draft.metalness}
                onCommit={(n) => {
                  if (Number.isFinite(n)) update({ metalness: n });
                }}
                onKeyDown={stop}
                style={numStyle}
              />
            </span>
          </div>

          <div
            style={rowStyle}
            title="How scattered the reflections are. 0 is a polished mirror, 1 a matt finish. Smooth render mode only."
          >
            <span style={labelStyle}>Roughness</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={draft.roughness}
                onChange={(e) =>
                  update({ roughness: parseFloat(e.target.value) })
                }
                onKeyDown={stop}
              />
              <NumberInput
                min="0"
                max="1"
                step="0.01"
                value={draft.roughness}
                onCommit={(n) => {
                  if (Number.isFinite(n)) update({ roughness: n });
                }}
                onKeyDown={stop}
                style={numStyle}
              />
            </span>
          </div>

          <div
            style={rowStyle}
            title="Strength of a glossy lacquer layer over the base. Higher adds a wet-looking sheen without changing the underlying colour."
          >
            <span style={labelStyle}>
              <span>Specular (clearcoat)</span>
              <span style={{ fontSize: 10, opacity: 0.7 }}>
                glossy top layer
              </span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={draft.clearcoat}
                onChange={(e) =>
                  update({ clearcoat: parseFloat(e.target.value) })
                }
                onKeyDown={stop}
              />
              <NumberInput
                min="0"
                max="1"
                step="0.01"
                value={draft.clearcoat}
                onCommit={(n) => {
                  if (Number.isFinite(n)) update({ clearcoat: n });
                }}
                onKeyDown={stop}
                style={numStyle}
              />
            </span>
          </div>

          {draft.clearcoat > 0 && (
            <div
              style={rowStyle}
              title="How blurred the clearcoat's sheen is. 0 gives a sharp gloss highlight, higher values a softer one."
            >
              <span style={labelStyle}>Clearcoat roughness</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={draft.clearcoatRoughness}
                  onChange={(e) =>
                    update({ clearcoatRoughness: parseFloat(e.target.value) })
                  }
                  onKeyDown={stop}
                />
                <NumberInput
                  min="0"
                  max="1"
                  step="0.01"
                  value={draft.clearcoatRoughness}
                  onCommit={(n) => {
                    if (Number.isFinite(n)) update({ clearcoatRoughness: n });
                  }}
                  onKeyDown={stop}
                  style={numStyle}
                />
              </span>
            </div>
          )}

          <div
            style={{
              borderTop: "1px solid var(--border-color)",
              marginTop: 8,
              paddingTop: 8,
            }}
          >
            <div style={rowStyle}>
              <span style={labelStyle}>Presets</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    color: "var(--text-secondary)",
                  }}
                  title="Keep the current color when applying a preset"
                >
                  <input
                    type="checkbox"
                    checked={ignorePresetColor}
                    onChange={(e) => setIgnorePresetColor(e.target.checked)}
                  />
                  Ignore colour
                </label>
                <select
                  className="variables-btn"
                  value=""
                  onChange={(e) => {
                    const all = [
                      ...BUILTIN_MATERIAL_PRESETS,
                      ...materialPresets,
                    ];
                    const preset = all.find((p) => p.name === e.target.value);
                    if (preset) applyPreset(preset.material);
                  }}
                  style={{ minWidth: 140 }}
                >
                  <option value="" disabled>
                    Apply preset…
                  </option>
                  {BUILTIN_MATERIAL_PRESETS.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                  {materialPresets.length > 0 && (
                    <optgroup label="Custom">
                      {materialPresets.map((p) => (
                        <option key={p.id} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>Save current as preset</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="text"
                  placeholder="Preset name"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => {
                    stop(e);
                    if (e.key === "Enter") savePreset();
                  }}
                  style={{ ...numStyle, width: 110, textAlign: "left" }}
                />
                <button
                  className="variables-btn"
                  onClick={savePreset}
                  disabled={!presetName.trim()}
                >
                  Save
                </button>
              </span>
            </div>
            {materialPresets.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  paddingTop: 4,
                }}
              >
                {materialPresets.map((p) => (
                  <span
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      color: "var(--text-secondary)",
                      background: "var(--bg-tertiary)",
                      borderRadius: 3,
                      padding: "2px 6px",
                    }}
                  >
                    {p.name}
                    <button
                      className="variables-row-remove"
                      title={`Delete preset "${p.name}"`}
                      onClick={() => removeMaterialPreset(p.id)}
                      style={{ width: 16, height: 16, fontSize: 13 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="variables-dialog-footer">
          <div />
          <div className="variables-dialog-actions">
            <button className="variables-btn" onClick={close}>
              Cancel
            </button>
            <button className="variables-btn primary" onClick={apply}>
              {isDefault ? "Set as Default" : "Apply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MaterialDialog;
