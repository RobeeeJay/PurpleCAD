// Shared styling for the bottom-centre tool overlay bar used by the create-time
// tools (Extrude/Revolve via SweepOverlay, Chamfer, Push/Pull, and the Plane /
// Mirror / Pattern tools).  The visual chrome comes from
// `.sketch-distance-input-overlay` in Viewport.css; these just size the inline
// fields/buttons and let a busy bar (e.g. the 6-field rectangular pattern) wrap
// onto a second centred row instead of running off-screen.

export const BAR_STYLE = {
  flexWrap: "wrap",
  rowGap: 6,
  maxWidth: "min(92vw, 780px)",
  justifyContent: "center",
};

export const LBL = { fontSize: 11, color: "#aaa", marginRight: 4 };

// Inline numeric field; the amber input look comes from the overlay CSS, so we
// only set the width and flag invalid values with a red border.
export const barInput = (ok) => ({
  width: 56,
  marginRight: 6,
  border: `1px solid ${ok ? "var(--border-color)" : "#e87575"}`,
});

// Cancel / Confirm style — accent = the primary (Confirm) button.
export const barBtn = (accent, disabled) => ({
  fontSize: 11,
  padding: "3px 10px",
  marginLeft: 8,
  borderRadius: 3,
  border: `1px solid ${accent ? "var(--accent, #4488ff)" : "var(--border-color)"}`,
  background: accent ? "var(--accent, #4488ff)" : "var(--bg-tertiary)",
  color: accent ? "#fff" : "var(--text-primary)",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.5 : 1,
});

// A small inline pick/base button; active = currently the live pick target.
export const pickBtn = (active) => ({
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 3,
  border: `1px solid ${active ? "#44aaff" : "var(--border-color)"}`,
  background: active ? "rgba(68,170,255,0.18)" : "var(--bg-tertiary)",
  color: "var(--text-primary)",
  cursor: "pointer",
});
