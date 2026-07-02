// Candidate custom-origin points for a 3D object, computed in the object's LOCAL
// geometry frame (the same frame item.origin is stored in).  Pure math over a
// flat positions array (+ optional index); no THREE / store dependency.

// Axis-aligned bounding-box centre of the vertices.
export function bboxCenterOf(positions) {
  if (!positions || positions.length < 3) return { x: 0, y: 0, z: 0 };
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  };
}

// Volume centroid (centre of mass for a uniform-density solid), summing the
// signed tetra (origin, a, b, c) moments over every triangle.  Falls back to the
// vertex average for a degenerate / open mesh whose net volume is ~0.
export function massCentroidOf(positions, indices = null) {
  if (!positions || positions.length < 9) return bboxCenterOf(positions);
  const tri = (k) => {
    const i = indices ? indices[k] * 3 : k * 3;
    return [positions[i], positions[i + 1], positions[i + 2]];
  };
  const count = indices ? indices.length : positions.length / 3;
  let vol = 0,
    cx = 0,
    cy = 0,
    cz = 0;
  for (let k = 0; k < count - 2; k += 3) {
    const a = tri(k),
      b = tri(k + 1),
      c = tri(k + 2);
    // Signed volume of the tetra from the origin to this triangle.
    const v =
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    vol += v;
    cx += ((a[0] + b[0] + c[0]) / 4) * v;
    cy += ((a[1] + b[1] + c[1]) / 4) * v;
    cz += ((a[2] + b[2] + c[2]) / 4) * v;
  }
  if (Math.abs(vol) < 1e-9) return bboxCenterOf(positions);
  return { x: cx / vol, y: cy / vol, z: cz / vol };
}

// Nearest vertex (local coords) to a local query point — used by the "point"
// origin mode to snap a click onto an actual corner of the geometry.
export function nearestVertexOf(positions, qx, qy, qz) {
  if (!positions || positions.length < 3) return { x: 0, y: 0, z: 0 };
  let best = 0,
    bestD = Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - qx,
      dy = positions[i + 1] - qy,
      dz = positions[i + 2] - qz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { x: positions[best], y: positions[best + 1], z: positions[best + 2] };
}
