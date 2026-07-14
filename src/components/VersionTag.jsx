import React, { useEffect, useState } from "react";
import { useStore } from "../store";
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

// Version/commit plus live scene totals (faces/points of every visible model
// mesh) and the renderer's JS heap.  Polled — the numbers are informational,
// not worth a per-frame subscription.
const VersionTag = () => {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const tick = () => {
      const cc = useStore.getState()._cameraControls;
      const scene = cc?.getSceneStats?.() ?? null;
      const mem = performance.memory
        ? Math.round(performance.memory.usedJSHeapSize / 1048576)
        : null;
      setStats(scene || mem != null ? { ...scene, mem } : null);
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="version-tag" aria-hidden="true">
      {stats && (
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
