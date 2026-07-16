import React, { useEffect, useState } from "react";
import { useStore } from "../store";
import {
  findClosedLoops,
  groupLoopsWithHoles,
} from "../three/sceneObjects/closedLoops.js";
import "../styles/VersionTag.css";

// __APP_VERSION__ and __GIT_COMMIT__ are baked in at build time by Vite's
// `define` (see vite.config.js).  Vitest doesn't run through that config
// so guard with `typeof` to keep the test bundle from blowing up.
const VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
const COMMIT = typeof __GIT_COMMIT__ === "string" ? __GIT_COMMIT__ : "dev";

const compact = (n) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `${(n / 1e3).toFixed(1)}k`
      : String(n);

// Fillable regions in the sketch, counting nested sub-regions (each gets its
// own fill) — the same hierarchy sceneBuilder renders.
export const sketchStats = (sketch) => {
  const shapes = sketch.shapes || [];
  let faces = 0;
  const collect = (e) => {
    faces += 1;
    e.entries.forEach(collect);
  };
  groupLoopsWithHoles(findClosedLoops(shapes)).forEach(collect);
  return {
    faces,
    lines: shapes.filter((s) => s.type !== "point").length,
    constraints: (sketch.constraints || []).length,
  };
};

// Version/commit plus live scene totals (faces/points of every visible model
// mesh) and the renderer's JS heap.  In sketch mode the totals switch to the
// sketch's faces/lines/constraints.  Polled — the numbers are informational,
// not worth a per-frame subscription.
const VersionTag = () => {
  const [stats, setStats] = useState(null);
  const inSketch = useStore((s) => {
    const it = s.items.find((i) => i.id === s.selectedId);
    return it?.type === "sketch";
  });

  useEffect(() => {
    const tick = () => {
      const s = useStore.getState();
      const mem = performance.memory
        ? Math.round(performance.memory.usedJSHeapSize / 1048576)
        : null;
      const it = s.items.find((i) => i.id === s.selectedId);
      if (it?.type === "sketch") {
        setStats({ sketch: sketchStats(it), mem });
        return;
      }
      const scene = s._cameraControls?.getSceneStats?.() ?? null;
      setStats(scene || mem != null ? { ...scene, mem } : null);
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [inSketch]);

  return (
    <div
      className={`version-tag${inSketch ? " version-tag-sketch" : ""}`}
      aria-hidden="true"
    >
      {stats && stats.sketch && (
        <>
          <span title="Faces / lines / constraints in the open sketch · renderer JS heap">
            {compact(stats.sketch.faces)} faces
            <span className="version-tag-sep">·</span>
            {compact(stats.sketch.lines)} lines
            <span className="version-tag-sep">·</span>
            {compact(stats.sketch.constraints)} constraints
            {stats.mem != null && (
              <>
                <span className="version-tag-sep">·</span>
                {stats.mem} MB
              </>
            )}
          </span>
          <span className="version-tag-sep">·</span>
        </>
      )}
      {stats && !stats.sketch && (
        <>
          <span title="Faces / points across all visible bodies · renderer JS heap">
            {compact(stats.faces ?? 0)} faces
            <span className="version-tag-sep">·</span>
            {compact(stats.points ?? 0)} pts
            {stats.mem != null && (
              <>
                <span className="version-tag-sep">·</span>
                {stats.mem} MB
              </>
            )}
          </span>
          <span className="version-tag-sep">·</span>
        </>
      )}
      v{VERSION}
      <span className="version-tag-sep">·</span>
      <span className="version-tag-commit">{COMMIT}</span>
    </div>
  );
};

export default VersionTag;
