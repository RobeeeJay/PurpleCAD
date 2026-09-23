import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import {
  TEXT_FONTS,
  makeTextShape,
  enumerateSystemFonts,
  ensureFontLoaded,
  fontSamplePath,
} from "../three/sketchText.js";
import { MM_PER_UNIT } from "../three/sceneObjects.js";
import { textSimplifyTol } from "../three/resolution.js";
import { NumberInput } from "./inputs.jsx";
import "../styles/VariablesDialog.css";

const BUNDLED_FONT_OPTIONS = TEXT_FONTS.map((f) => ({
  id: f.id,
  label: f.label,
}));

// One row of the font list: the family name, and beside it the same name drawn
// in that face.  An installed family is set in CSS by name; a bundled font is
// typeface JSON no browser knows, so its sample is traced from the outlines the
// sketch itself would use.
// Traced once per face: filtering unmounts and remounts the rows, so a
// per-row memo would re-trace on every keystroke.
// Keep in step with .font-picker-list's max-height.
const LIST_MAX_PX = 260;

const sampleCache = new Map();
const cachedSample = (id, label) => {
  if (!sampleCache.has(id)) sampleCache.set(id, fontSamplePath(id, label, 16));
  return sampleCache.get(id);
};

const FontSample = ({ option }) => {
  const sys = option.id.startsWith("sys:");
  const path = sys ? null : cachedSample(option.id, option.label);
  if (sys)
    return (
      <span
        className="font-row-sample"
        style={{ fontFamily: `"${option.label}"` }}
      >
        {option.label}
      </span>
    );
  if (!path) return null;
  return (
    <svg
      className="font-row-sample"
      viewBox={`0 0 ${path.width.toFixed(2)} ${path.height.toFixed(2)}`}
      height="14"
      width={Math.min(200, (14 * path.width) / (path.height || 1)).toFixed(0)}
      aria-hidden="true"
    >
      <path d={path.d} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
};

// Type to filter, then pick from a scrollable list.  This was a <datalist>,
// which the browser both FILTERS by whatever is already in the field (opening
// it on the current font showed almost nothing — the "incomplete list") and
// caps in height with no scrolling of its own, and whose options cannot carry
// a preview.
const FontPicker = ({
  options,
  value,
  onPick,
  onFieldKey,
  onOpen,
  systemFontsOff,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // This dialog is anchored to the BOTTOM of the window, so a list that always
  // dropped downward would open past the bottom edge and be unreachable.
  const [up, setUp] = useState(false);
  const listRef = useRef(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  // Set while focus is handed back after a pick, so returning it does not
  // immediately reopen the list that was just dismissed.
  const keepShutRef = useRef(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? options.filter((f) => f.label.toLowerCase().includes(q))
      : options;
  }, [options, query]);

  // Close when the click lands anywhere else.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // Keep the keyboard selection in view as it moves past the visible rows.
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const openList = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setUp(window.innerHeight - r.bottom < LIST_MAX_PX + 16);
    setOpen(true);
    // Opening the list is a fresh user gesture, which is what queryLocalFonts
    // wants -- a retry on a timer has none.
    onOpen?.();
  };

  const choose = (f) => {
    onPick(f);
    setOpen(false);
    setQuery("");
    // Focus goes back to the field: the row button that had it is unmounting,
    // which would leave focus on nothing and Escape -- handled per field --
    // with nowhere to land, so the dialog could not be dismissed afterwards.
    keepShutRef.current = true;
    inputRef.current?.focus();
  };

  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      // The list closes first; a second Escape closes the dialog.
      if (open) {
        setOpen(false);
        return;
      }
      onFieldKey(e);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openList();
      setActive((i) => {
        const n = shown.length;
        if (!n) return 0;
        return e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n;
      });
      return;
    }
    if (e.key === "Enter" && open && shown[active]) {
      e.preventDefault();
      choose(shown[active]);
    }
  };

  return (
    <div className="font-picker" ref={wrapRef}>
      <input
        className="font-picker-input"
        value={open ? query : value}
        placeholder={value}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        ref={inputRef}
        onFocus={() => {
          if (keepShutRef.current) {
            keepShutRef.current = false;
            return;
          }
          openList();
        }}
        // Focus alone can't carry this: after a pick the field keeps focus, so
        // a later click fires no focus event and the list would never reopen.
        onClick={() => {
          if (!open) openList();
        }}
        onKeyDown={onKey}
        aria-label="Font"
      />
      {open && (
        <div
          className={`font-picker-list ${up ? "up" : ""}`}
          ref={listRef}
          role="listbox"
        >
          {shown.map((f, i) => (
            <button
              type="button"
              key={f.id}
              role="option"
              aria-selected={f.label === value}
              className={`font-row ${i === active ? "active" : ""} ${
                f.label === value ? "chosen" : ""
              }`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(f)}
            >
              <span className="font-row-name">{f.label}</span>
              <FontSample option={f} />
            </button>
          ))}
          {shown.length === 0 && (
            <div className="font-row-empty">No font matches that name.</div>
          )}
          {systemFontsOff && (
            <div className="font-row-empty">
              Only the built-in fonts are listed — PurpleCAD could not read the
              installed ones.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

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
  const [systemFontsOff, setSystemFontsOff] = useState(false);

  // Append installed system fonts (async, permission-gated) to the list.  One
  // attempt is not enough: queryLocalFonts needs a recent user gesture and can
  // come back empty while the permission prompt is still up, and the old
  // single shot then left the dialog on the four bundled fonts for as long as
  // it stayed open.  Keep asking for a few seconds, then say so in the list.
  const cancelledRef = useRef(false);
  const loadFonts = (retries = 0) => {
    enumerateSystemFonts().then((sys) => {
      if (cancelledRef.current) return;
      if (sys.length) {
        setFontOptions([...BUNDLED_FONT_OPTIONS, ...sys]);
        setSystemFontsOff(false);
      } else if (retries > 0) setTimeout(() => loadFonts(retries - 1), 700);
      else setSystemFontsOff(true);
    });
  };
  useEffect(() => {
    cancelledRef.current = false;
    loadFonts(5);
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Parse a system font before switching so the preview/commit have outlines.
  const onFontPick = (f) => {
    ensureFontLoaded(f.id).then((ok) => {
      if (ok) updateTextDraft({ font: f.id });
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
      tolerance: textSimplifyTol(),
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
            title="The characters drawn into the sketch. Each line becomes its own row of outlines, which can then be extruded or embossed."
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
              title="Cap height of the text. The width follows to keep the letter shapes, so wider strings grow sideways as this goes up."
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 12,
                flex: "0 0 110px",
              }}
            >
              Height (mm)
              <NumberInput
                min="0"
                step="1"
                value={textDraft.heightMm}
                onCommit={(n) => updateTextDraft({ heightMm: n })}
                onKeyDown={onFieldKey}
              />
            </label>
            <label
              title="Typeface the outlines are traced from. Changing it redraws the letters, so their widths and any stroke thicknesses change with it."
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 12,
                flex: 1,
              }}
            >
              Font
              <FontPicker
                options={fontOptions}
                value={fontLabel}
                onPick={onFontPick}
                onFieldKey={onFieldKey}
                onOpen={() => {
                  if (systemFontsOff) loadFonts(0);
                }}
                systemFontsOff={systemFontsOff}
              />
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
