import React, { useEffect, useState } from "react";
import { useStore } from "../store";
import { MM_PER_UNIT } from "../three/sceneObjects.js";
import { DISPLAY_AXES, toDisplay } from "../utils/axisDisplay.js";

// A status line shown while an object is selected: its world-space position
// (mm) and the face / point counts of its mesh.  Reads the live scene mesh via
// _cameraControls after the frame paints, so it reflects the current geometry.
const StatusLine = () => {
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const [stats, setStats] = useState(null);

  const selected = items.find((i) => i.id === selectedId);
  const showable = selected && selected.type !== "sketch";

  useEffect(() => {
    if (!showable) {
      setStats(null);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const cc = useStore.getState()._cameraControls;
      setStats(cc?.getObjectStats?.(selectedId) ?? null);
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedId, items, showable]);

  if (!showable || !stats) return null;

  const mm = (v) => (v * MM_PER_UNIT).toFixed(1);
  const p = stats.worldPosition;

  return (
    <div className="status-line">
      <span className="status-line-name">{selected.name}</span>
      <span className="status-line-sep">·</span>
      <span>
        {DISPLAY_AXES.map((a) => `${a.label} ${mm(toDisplay(p, a))}`).join(
          "  ",
        )}{" "}
        mm
      </span>
      <span className="status-line-sep">·</span>
      <span>{Math.round(stats.faces).toLocaleString()} faces</span>
      <span className="status-line-sep">·</span>
      <span>{stats.points.toLocaleString()} points</span>
    </div>
  );
};

export default StatusLine;
