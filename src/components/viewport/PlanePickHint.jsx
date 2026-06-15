import React, { useEffect } from "react";
import { useStore } from "../../store";

// Hint shown while picking the 3 points that define a new Plane.  Esc cancels.
export default function PlanePickHint() {
  const active = useStore((s) => s.planePickActive);
  const setActive = useStore((s) => s.setPlanePickActive);

  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        useStore.getState()._cameraControls?.clearPlanePick?.();
        setActive(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, setActive]);

  if (!active) return null;
  return (
    <div className="sketch-placement-hint">
      Click 3 points to define a plane (e.g. two ends of an edge + a point) ·
      Esc to cancel
    </div>
  );
}
