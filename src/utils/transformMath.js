// Pure transform maths shared by the transform panel, kept out of the JSX so
// it's unit-testable.  Lengths are in mm; `localSize` is the unscaled geometry
// size in mm (per axis), so a shown length = localSize[axis] * scale[axis].

// Convert an edited length (mm) on one axis into a new per-axis scale object.
//   locked   → scale all three axes by the same factor (proportional resize)
//   unlocked → change only `axis` (stretch)
// Returns null for a non-positive length or missing local size.
export function lengthToScale(scale, localSize, axis, mm, locked) {
  if (!(mm > 0) || !localSize || !localSize[axis]) return null;
  if (locked) {
    const factor = mm / (localSize[axis] * scale[axis]);
    return { x: scale.x * factor, y: scale.y * factor, z: scale.z * factor };
  }
  return { ...scale, [axis]: mm / localSize[axis] };
}

// The shown length (mm) of an axis for a given scale + unscaled local size.
export function scaleToLength(scale, localSize, axis) {
  return localSize && localSize[axis] != null
    ? localSize[axis] * scale[axis]
    : null;
}
