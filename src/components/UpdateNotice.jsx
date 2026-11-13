import { useEffect } from "react";
import { useStore } from "../store";
import { skippedUpdateVersion } from "../store/internals.js";
import "../styles/VariablesDialog.css";

// Asks once per launch whether GitHub has a newer release, and offers it.
// Only where the host provides the check (the desktop app's main process):
// the iPad updates through the App Store, which forbids pointing elsewhere.
// Never in an e2e build, which must not reach the network.
const UpdateNotice = () => {
  const update = useStore((s) => s.availableUpdate);

  useEffect(() => {
    if (typeof __E2E__ !== "undefined" && __E2E__) return;
    const check = window.electronAPI?.checkForUpdate;
    if (!check || !useStore.getState().checkForUpdates) return;
    check().then((found) => {
      if (found && found.version !== skippedUpdateVersion())
        useStore.getState().setAvailableUpdate(found);
    });
  }, []);

  if (!update) return null;
  const s = useStore.getState();
  const download = () => {
    window.electronAPI.openExternal(update.url);
    s.setAvailableUpdate(null);
  };

  return (
    <div className="update-notice" role="status" aria-label="Update available">
      <div className="update-notice-head">
        <span>PurpleCAD {update.version} is available</span>
        <button
          className="variables-dialog-close"
          title="Close"
          onClick={() => s.setAvailableUpdate(null)}
        >
          ×
        </button>
      </div>
      <div className="update-notice-actions">
        <button className="variables-btn" onClick={s.skipAvailableUpdate}>
          Skip this version
        </button>
        <button className="variables-btn primary" onClick={download}>
          Download
        </button>
      </div>
    </div>
  );
};

export default UpdateNotice;
