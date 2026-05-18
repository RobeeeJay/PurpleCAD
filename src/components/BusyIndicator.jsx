import React, { useEffect, useState } from "react";
import { useStore } from "../store";
import "../styles/BusyIndicator.css";

// Shows a centred spinner over the 3D viewport ONLY after work has been
// in flight for > 200ms.  Short operations (a quick chamfer / boolean on
// a simple shape) finish before the timeout and the spinner never
// appears, so the UI doesn't flicker on fast clicks.  Anything that
// drags on past 200ms gets a clear "still working" affordance.
const APPEAR_DELAY_MS = 200;

const BusyIndicator = () => {
  const pending = useStore((s) => s.pendingOperations);
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    if (pending <= 0) {
      setShowing(false);
      return undefined;
    }
    const id = setTimeout(() => setShowing(true), APPEAR_DELAY_MS);
    return () => clearTimeout(id);
  }, [pending]);

  if (!showing) return null;
  return (
    <div className="busy-indicator" role="status" aria-live="polite">
      <div className="busy-spinner" />
      <span className="busy-label">Working…</span>
    </div>
  );
};

export default BusyIndicator;
