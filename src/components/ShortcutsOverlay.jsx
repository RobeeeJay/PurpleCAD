import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import "../styles/ShortcutsOverlay.css";

// Held-? help: press and hold the ? key for >1s to reveal the keyboard
// shortcuts for the current mode (3D view vs sketch). Release to dismiss.

const isMac = navigator.platform.toUpperCase().includes("MAC");
const MOD = isMac ? "⌘" : "Ctrl";
const SHIFT = isMac ? "⇧" : "Shift";

const GENERAL = [
  { keys: [MOD, "Z"], label: "Undo" },
  { keys: [MOD, SHIFT, "Z"], label: "Redo" },
  { keys: ["Esc"], label: "Cancel tool / clear selection" },
  { keys: ["?"], label: "Hold for this help" },
];

const VIEW_3D = [
  { keys: ["1"], label: "Wireframe" },
  { keys: ["2"], label: "Transparent" },
  { keys: ["3"], label: "Shaded" },
  { keys: ["4"], label: "Path-traced render" },
  { keys: ["5"], label: "Toggle shadows" },
  { keys: ["6"], label: "Toggle cross-section" },
  { keys: ["8"], label: "Toggle curve resolution" },
  { keys: ["Z"], label: "Select objects" },
  { keys: ["X"], label: "Select faces" },
  { keys: ["C"], label: "Select edges" },
  { keys: ["V"], label: "Select points" },
  { keys: [SHIFT, "Z"], label: "Toggle constraints (hold Shift for widget)" },
  { keys: [SHIFT, "X"], label: "Toggle dimensions" },
];

const SKETCH = [
  { keys: ["L"], label: "Line" },
  { keys: ["R"], label: "Rectangle" },
  { keys: ["E"], label: "Ellipse" },
  { keys: ["A"], label: "Arc" },
  { keys: ["D"], label: "Distance dimension" },
  { keys: ["I"], label: "Toggle construction line" },
  { keys: ["O"], label: "Offset (Shift: other side)" },
  { keys: ["Z"], label: "Select objects" },
  { keys: ["X"], label: "Select shapes (regions)" },
  { keys: ["C"], label: "Select lines / curves" },
  { keys: ["V"], label: "Select points" },
  { keys: ["B"], label: "Select constraints" },
  { keys: [SHIFT, "Z"], label: "Toggle constraints (hold Shift for widget)" },
  { keys: [SHIFT, "X"], label: "Toggle dimensions" },
  { keys: ["↑", "↓", "←", "→"], label: "Nudge selection 1mm" },
  { keys: [MOD, "G"], label: "Group selection" },
  { keys: [MOD, "U"], label: "Ungroup selection" },
  { keys: [MOD, "C"], label: "Copy" },
  { keys: [MOD, "V"], label: "Paste" },
  { keys: ["Del"], label: "Delete selection / constraint" },
];

const Section = ({ title, rows }) => (
  <div className="shortcuts-section">
    <h3>{title}</h3>
    {rows.map((r) => (
      <div className="shortcuts-row" key={r.label}>
        <span className="shortcuts-label">{r.label}</span>
        <span className="shortcuts-keys">
          {r.keys.map((k, i) => (
            <kbd className="shortcuts-key" key={i}>
              {k}
            </kbd>
          ))}
        </span>
      </div>
    ))}
  </div>
);

const isTypingTarget = (t) =>
  t &&
  (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

const ShortcutsOverlay = () => {
  const [open, setOpen] = useState(false);
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const isSketch = items.find((i) => i.id === selectedId)?.type === "sketch";
  const timerRef = useRef(null);

  useEffect(() => {
    const cancel = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setOpen(false);
    };
    const onDown = (e) => {
      // Ignore key auto-repeat and typing in fields; arm a 1s hold timer.
      if (e.key !== "?" || e.repeat || timerRef.current) return;
      if (isTypingTarget(e.target)) return;
      timerRef.current = setTimeout(() => setOpen(true), 1000);
    };
    const onUp = (e) => {
      // Releasing ?, the / it sits on, or Shift ends the hold.
      if (e.key === "?" || e.key === "/" || e.key === "Shift") cancel();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", cancel);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!open) return null;
  return (
    <div className="shortcuts-overlay-backdrop">
      <div className="shortcuts-overlay">
        <h2>Keyboard shortcuts</h2>
        <div className="shortcuts-columns">
          <Section
            title={isSketch ? "Sketch mode" : "3D view"}
            rows={isSketch ? SKETCH : VIEW_3D}
          />
          <Section title="General" rows={GENERAL} />
        </div>
        <div className="shortcuts-hint">Release ? to close</div>
      </div>
    </div>
  );
};

export default ShortcutsOverlay;
