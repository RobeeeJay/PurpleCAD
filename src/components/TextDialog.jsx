import React, { useEffect, useState } from "react";
import { useStore } from "../store";
import {
  TEXT_FONTS,
  makeTextShape,
  enumerateSystemFonts,
  ensureFontLoaded,
} from "../three/sketchText.js";
import { MM_PER_UNIT } from "../three/sceneObjects.js";
import "../styles/VariablesDialog.css";

const BUNDLED_FONT_OPTIONS = TEXT_FONTS.map((f) => ({
  id: f.id,
  label: f.label,
}));

// Text tool dialog: edits the staged `textDraft` (anchor + text + height + font)
// with a live on-plane preview, then commits a locked `text` shape joined to a
// `text` constraint. Re-opened (with editIdx set) by double-clicking that
// constraint to change an existing text.
const TextDialog = () => {
  const textDraft = useStore((s) => s.textDraft);
  const updateTextDraft = useStore((s) => s.updateTextDraft);
  const clearTextDraft = useStore((s) => s.clearTextDraft);
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const [fontOptions, setFontOptions] = useState(BUNDLED_FONT_OPTIONS);

  // Append installed system fonts (async, permission-gated) to the dropdown.
  useEffect(() => {
    let cancelled = false;
    enumerateSystemFonts().then((sys) => {
      if (!cancelled && sys.length)
        setFontOptions([...BUNDLED_FONT_OPTIONS, ...sys]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Drive the live preview from the current draft; ensure the (possibly system)
  // font is parsed, then refresh.  Clear it on close/unmount.
  useEffect(() => {
    const cc = useStore.getState()._cameraControls;
    if (!textDraft) return undefined;
    let cancelled = false;
    cc?.updateTextPreview?.(textDraft);
    ensureFontLoaded(textDraft.font).then((ok) => {
      if (ok && !cancelled)
        cc?.updateTextPreview?.(useStore.getState().textDraft);
    });
    return () => {
      cancelled = true;
      cc?.clearTextPreview?.();
    };
  }, [textDraft]);

  if (!textDraft) return null;
  const sketch = items.find((i) => i.id === selectedId);
  const fontLabel = textDraft.font?.startsWith("sys:")
    ? textDraft.font.slice(4)
    : TEXT_FONTS.find((f) => f.id === textDraft.font)?.label || "";

  const close = () => {
    useStore.getState()._cameraControls?.clearTextPreview?.();
    clearTextDraft();
  };
  // Fields stop propagation (so typing doesn't hit sketch shortcuts) but still
  // close the dialog on Escape.
  const onFieldKey = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") close();
  };

  const onFontInput = (v) => {
    const lc = v.toLowerCase();
    const match =
      fontOptions.find((f) => f.label.toLowerCase() === lc) ||
      fontOptions.find((f) => f.label.toLowerCase().startsWith(lc));
    if (!match) return;
    // Parse a system font before switching so the preview/commit have outlines.
    ensureFontLoaded(match.id).then((ok) => {
      if (ok) updateTextDraft({ font: match.id });
    });
  };

  const canConfirm =
    textDraft.text.trim().length > 0 && textDraft.heightMm > 0 && sketch;
  const confirm = () => {
    if (!canConfirm) return;
    const shape = makeTextShape({
      text: textDraft.text,
      height: textDraft.heightMm / MM_PER_UNIT,
      font: textDraft.font,
      x: textDraft.x,
      y: textDraft.y,
    });
    const store = useStore.getState();
    if (textDraft.editIdx != null) {
      store.updateSketchTextShape(selectedId, textDraft.editIdx, shape);
    } else {
      const baseIdx = (sketch.shapes || []).length;
      store.addSketchShapes(
        selectedId,
        [shape],
        [{ type: "text", shapeIdx: baseIdx }],
      );
    }
    close();
  };

  return (
    <div
      className="variables-dialog-backdrop"
      style={{
        background: "transparent",
        alignItems: "flex-end",
        paddingBottom: 72,
        pointerEvents: "none",
      }}
    >
      <div
        className="variables-dialog"
        style={{ minWidth: 340, pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="variables-dialog-header">
          <h2>{textDraft.editIdx != null ? "Edit text" : "Text"}</h2>
          <button
            className="variables-dialog-close"
            onClick={close}
            title="Cancel"
          >
            ×
          </button>
        </div>
        <div
          style={{
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              fontSize: 12,
            }}
          >
            Text
            <textarea
              autoFocus
              rows={3}
              value={textDraft.text}
              onChange={(e) => updateTextDraft({ text: e.target.value })}
              onKeyDown={onFieldKey}
              style={{
                resize: "vertical",
                fontFamily: "inherit",
                fontSize: 13,
              }}
            />
          </label>
          <div style={{ display: "flex", gap: 12 }}>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 12,
                flex: "0 0 110px",
              }}
            >
              Height (mm)
              <input
                type="number"
                min="0"
                step="1"
                value={
                  Number.isFinite(textDraft.heightMm) ? textDraft.heightMm : ""
                }
                onChange={(e) =>
                  updateTextDraft({ heightMm: parseFloat(e.target.value) })
                }
                onKeyDown={onFieldKey}
              />
            </label>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 12,
                flex: 1,
              }}
            >
              Font
              <input
                list="text-font-list"
                defaultValue={fontLabel}
                onChange={(e) => onFontInput(e.target.value)}
                onKeyDown={onFieldKey}
              />
              <datalist id="text-font-list">
                {fontOptions.map((f) => (
                  <option key={f.id} value={f.label} />
                ))}
              </datalist>
            </label>
          </div>
        </div>
        <div className="variables-dialog-footer">
          <div />
          <div className="variables-dialog-actions">
            <button className="variables-btn" onClick={close}>
              Cancel
            </button>
            <button
              className="variables-btn primary"
              disabled={!canConfirm}
              onClick={confirm}
            >
              {textDraft.editIdx != null ? "Update" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TextDialog;
