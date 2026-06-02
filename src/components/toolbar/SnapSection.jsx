import React from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

// Snap-to-grid toggle + configurable interval (mm) and rotation step (deg).
// Applies to both sketch drags and 3D gizmo move/rotate.
const SnapSection = () => {
  const snapEnabled = useStore((s) => s.snapEnabled);
  const toggleSnap = useStore((s) => s.toggleSnap);
  const snapDistanceMm = useStore((s) => s.snapDistanceMm);
  const setSnapDistanceMm = useStore((s) => s.setSnapDistanceMm);
  const snapAngleDeg = useStore((s) => s.snapAngleDeg);
  const setSnapAngleDeg = useStore((s) => s.setSnapAngleDeg);

  // Local buffers so typing a partial value (e.g. "0.") doesn't get clobbered
  // by the store's validation until the field is committed.
  const [distStr, setDistStr] = React.useState(String(snapDistanceMm));
  const [angStr, setAngStr] = React.useState(String(snapAngleDeg));
  React.useEffect(() => setDistStr(String(snapDistanceMm)), [snapDistanceMm]);
  React.useEffect(() => setAngStr(String(snapAngleDeg)), [snapAngleDeg]);

  const inputStyle = {
    width: 40,
    fontSize: 11,
    padding: "2px 3px",
    textAlign: "right",
  };
  const unitStyle = { fontSize: 9, opacity: 0.7, marginLeft: 3 };
  const rowStyle = { display: "flex", alignItems: "center" };

  const onFieldKey = (e, commit) => {
    e.stopPropagation();
    if (e.key === "Enter") commit();
  };

  return (
    <ToolbarSection label="Snap">
      <button
        className={`toolbar-btn ${snapEnabled ? "active" : ""}`}
        title={`${snapEnabled ? "Disable" : "Enable"} snap to grid (${snapDistanceMm}mm / ${snapAngleDeg}°)`}
        onClick={toggleSnap}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M6 3v7a6 6 0 0 0 12 0V3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <line
            x1="5"
            y1="3"
            x2="9"
            y2="3"
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <line
            x1="15"
            y1="3"
            x2="19"
            y2="3"
            stroke="currentColor"
            strokeWidth="2.5"
          />
        </svg>
      </button>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          justifyContent: "center",
        }}
      >
        <div style={rowStyle}>
          <input
            type="number"
            min="0.1"
            step="0.5"
            value={distStr}
            onChange={(e) => setDistStr(e.target.value)}
            onBlur={() => setSnapDistanceMm(distStr)}
            onKeyDown={(e) => onFieldKey(e, () => setSnapDistanceMm(distStr))}
            style={inputStyle}
            title="Snap distance (mm)"
          />
          <span style={unitStyle}>mm</span>
        </div>
        <div style={rowStyle}>
          <input
            type="number"
            min="0.1"
            step="1"
            value={angStr}
            onChange={(e) => setAngStr(e.target.value)}
            onBlur={() => setSnapAngleDeg(angStr)}
            onKeyDown={(e) => onFieldKey(e, () => setSnapAngleDeg(angStr))}
            style={inputStyle}
            title="Snap angle (degrees)"
          />
          <span style={unitStyle}>&deg;</span>
        </div>
      </div>
    </ToolbarSection>
  );
};

export default SnapSection;
