// Shared styling for the bottom-centre tool overlay bar used by the create-time
// tools (Extrude/Revolve via SweepOverlay, Chamfer, Push/Pull, and the Plane /
// Mirror / Pattern tools).  The visual chrome comes from
// `.sketch-distance-input-overlay` in Viewport.css; these just size the inline
// fields/buttons and let a busy bar (e.g. the 6-field rectangular pattern) wrap
// onto a second centred row instead of running off-screen.

import React from "react";

export const BAR_STYLE = {
  flexWrap: "wrap",
  rowGap: 6,
  maxWidth: "min(92vw, 780px)",
  justifyContent: "center",
};

export const LBL = { fontSize: 11, color: "#aaa", marginRight: 4 };

// Groups a label with its input as ONE flex item so the bar (flex-wrap) never
// breaks the line BETWEEN a label and the field it names.  `style` lets a caller
// keep the spacing it used on the bare label (e.g. marginLeft).
// `hint` says what CHANGING the value does, and sits on the wrapper so hovering
// either the label or the field itself shows it.
export const Field = ({ label, style, hint, children }) =>
  React.createElement(
    "span",
    {
      title: hint,
      style: {
        display: "inline-flex",
        alignItems: "center",
        whiteSpace: "nowrap",
        ...style,
      },
    },
    React.createElement("span", { style: LBL }, label),
    children,
  );

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
// A faint translucent fill is invisible on the light theme, so the active state
// uses a SOLID accent with contrasting text — clearly readable in both themes.
export const pickBtn = (active, disabled) => ({
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 3,
  border: `1px solid ${active ? "var(--accent, #4488ff)" : "var(--border-color)"}`,
  background: active ? "var(--accent, #4488ff)" : "var(--bg-tertiary)",
  color: active ? "#fff" : "var(--text-primary)",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.5 : 1,
});

// A toggle button (emboss/deboss, mirror, projection, draft flip, …).  Shared so
// the "on" state is the same clearly-visible accent fill across every dialog.
export const toggleBtn = (on) => ({
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 3,
  border: `1px solid ${on ? "var(--accent, #4488ff)" : "var(--border-color)"}`,
  background: on ? "var(--accent, #4488ff)" : "var(--bg-tertiary)",
  color: on ? "#fff" : "var(--text-primary)",
  cursor: "pointer",
});
