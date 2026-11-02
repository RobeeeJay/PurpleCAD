// The field shown while a line or circle is being drawn.  It holds focus, so a
// size can simply be typed; left alone it only reports what the cursor measures
// and the shape gets no dimension.

import React from "react";
import FormulaInput from "../FormulaInput";
import { useStore } from "../../store";

export default function SketchDrawLengthOverlay({ variables }) {
  const { tool, typed, live, segment } = useStore((s) => s.sketchDrawLength);
  const inputRef = React.useRef(null);
  const circle = tool === "circle";

  React.useEffect(() => {
    useStore.getState()._cameraControls?.refreshSketchDraw?.();
  }, [typed]);

  if (tool !== "line" && !circle) return null;

  const hint = circle
    ? "Diameter of the circle. Typing one adds a dimension that holds it; left empty, the cursor sets the size and no dimension is added."
    : "Length of the line. Typing one adds a dimension that holds it and the cursor only aims the line; left empty, no dimension is added.";

  return (
    <>
      <div className="sketch-placement-hint">
        {circle
          ? "Click the edge, or type a diameter and press Enter · Esc to cancel"
          : "Click the end point, or type a length and press Enter · Esc to cancel"}
      </div>
      <div className="sketch-draw-length-overlay" title={hint}>
        <span>{circle ? "Diameter (mm):" : "Length (mm):"}</span>
        <FormulaInput
          // Remounts for each new segment of a chain, which refocuses it after
          // the click on the canvas took the focus away.
          key={segment}
          ref={inputRef}
          type="text"
          autoFocus
          title={hint}
          variables={variables}
          value={typed}
          placeholder={live}
          onChange={(e) =>
            useStore.getState().setSketchDrawLengthTyped(e.target.value)
          }
          // A drag that orbits the view takes the focus too, and the next key
          // would then be read as a tool shortcut instead of a digit.
          onBlur={() =>
            requestAnimationFrame(() => {
              if (document.activeElement === document.body)
                inputRef.current?.focus();
            })
          }
          onKeyDown={(e) => {
            e.stopPropagation();
            const cc = useStore.getState()._cameraControls;
            if (e.key === "Enter") {
              if (typed.trim()) cc?.commitSketchDraw?.();
            } else if (e.key === "Escape") {
              cc?.cancelSketchDraw?.();
            }
          }}
        />
      </div>
    </>
  );
}
