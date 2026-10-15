import { useEffect, useState } from "react";
import { useStore } from "../store";
import "../styles/BusyIndicator.css";

// Shows a centred spinner over the 3D viewport ONLY after work has been
// in flight for > 200ms.  Short operations (a quick chamfer / boolean on
// a simple shape) finish before the timeout and the spinner never
// appears, so the UI doesn't flicker on fast clicks.  Anything that
// drags on past 200ms gets a clear "still working" affordance.
//
// If a timeline-recalculation is publishing progress while the spinner
// is shown, a progress bar appears under the label.  Pure OCC ops that
// don't drive `regenProgress` keep the original spinner-only look.
const APPEAR_DELAY_MS = 200;

const BusyIndicator = () => {
  const pending = useStore((s) => s.pendingOperations);
  const regenProgress = useStore((s) => s.regenProgress);
  const requestOperationCancel = useStore((s) => s.requestOperationCancel);
  const [showing, setShowing] = useState(false);

  const regenActive = regenProgress != null && regenProgress.total > 0;
  const busy = pending > 0 || regenActive;

  useEffect(() => {
    if (!busy) {
      setShowing(false);
      return undefined;
    }
    const id = setTimeout(() => setShowing(true), APPEAR_DELAY_MS);
    return () => clearTimeout(id);
  }, [busy]);

  if (!showing) return null;
  const pct = regenActive
    ? Math.min(
        100,
        Math.round((regenProgress.current / regenProgress.total) * 100),
      )
    : null;
  return (
    <div className="busy-indicator" role="status" aria-live="polite">
      <div className="busy-spinner" />
      <span className="busy-label">
        {regenActive
          ? `Recalculating ${regenProgress.current} / ${regenProgress.total}…`
          : "Working…"}
      </span>
      {regenActive && (
        <div
          className="busy-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={regenProgress.total}
          aria-valuenow={regenProgress.current}
        >
          <div className="busy-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
      <button
        type="button"
        className="busy-cancel"
        onClick={requestOperationCancel}
        title="Stop this operation"
      >
        Cancel
      </button>
    </div>
  );
};

export default BusyIndicator;
