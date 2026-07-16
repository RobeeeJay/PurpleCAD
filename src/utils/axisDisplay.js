// The UX presents a Z-up right-handed frame matching the STL/STEP exports
// (which rotate +π/2 about X): user X,Y,Z = internal x,−z,y.  The scene stays
// three.js Y-up.  EVERY UI surface that shows an axis letter or an
// axis-labeled value must map through this table — a hardcoded letter lies
// about the internal component under it.
export const DISPLAY_AXES = [
  { label: "X", key: "x", sign: 1 },
  { label: "Y", key: "z", sign: -1 },
  { label: "Z", key: "y", sign: 1 },
];

// Signed component in the user frame (position, rotation, spacing).
export const toDisplay = (vec, axis) => axis.sign * (vec?.[axis.key] ?? 0);
// Inverse: a user-entered signed value back to the internal component.
export const fromDisplay = (value, axis) => axis.sign * value;
