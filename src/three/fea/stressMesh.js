// The display mesh for a stress field: the body's surface, subdivided until a
// triangle is small enough to show variation, and sampled from the volumetric
// field rather than interpolated between corners.
//
// A CAD body carries almost no vertices on its flat faces -- a fused box has
// eight in total, and a per-vertex plot on it came out with eight distinct
// colours across the whole part.  Since flat faces are exactly where a bracket
// is interesting, the plot has to carry its own resolution instead of
// inheriting the tessellation's.
//
// Pure arrays -- no THREE, no DOM.

// Trilinear sample of the element-centre field, skipping voxels outside the
// body so a point on the surface is not dragged toward zero by the empty half
// of its neighbourhood.
export function sampleField({ grid, field, occ }, x, y, z) {
  const { origin, h, nx, ny, nz } = grid;
  const g = [
    (x - origin[0]) / h - 0.5,
    (y - origin[1]) / h - 0.5,
    (z - origin[2]) / h - 0.5,
  ];
  const base = g.map(Math.floor);
  const f = g.map((v, i) => v - base[i]);
  let sum = 0,
    wsum = 0;
  for (let a = 0; a < 2; a++)
    for (let b = 0; b < 2; b++)
      for (let c = 0; c < 2; c++) {
        const i = base[0] + a,
          j = base[1] + b,
          k = base[2] + c;
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
        const e = i + nx * (j + ny * k);
        if (!occ[e]) continue;
        const w =
          (a ? f[0] : 1 - f[0]) * (b ? f[1] : 1 - f[1]) * (c ? f[2] : 1 - f[2]);
        sum += field[e] * w;
        wsum += w;
      }
  return wsum > 0 ? sum / wsum : 0;
}

// Split every triangle until its longest edge is at most `maxEdge`, capped by
// a triangle budget so a dense import cannot blow the renderer up.  Returns a
// flat soup (no shared vertices): the field is sampled per point, so sharing
// buys nothing and welding costs more than it saves.
export function subdivideSoup(positions, indices, maxEdge, budget = 400000) {
  const src = [];
  const count = indices ? indices.length / 3 : positions.length / 9;
  for (let t = 0; t < count; t++) {
    const v = [0, 1, 2].map((c) =>
      indices ? indices[t * 3 + c] * 3 : (t * 3 + c) * 3,
    );
    src.push(v.map((o) => [positions[o], positions[o + 1], positions[o + 2]]));
  }
  const longest = (tri) =>
    Math.max(
      ...[
        [0, 1],
        [1, 2],
        [2, 0],
      ].map(([a, b]) => Math.hypot(...tri[a].map((v, i) => v - tri[b][i]))),
    );
  let queue = src;
  // Split the LONGEST edge only, which keeps sliver triangles from being
  // manufactured out of a well-shaped one.
  for (let pass = 0; pass < 12; pass++) {
    const next = [];
    let split = false;
    for (const tri of queue) {
      if (queue.length + next.length >= budget || longest(tri) <= maxEdge) {
        next.push(tri);
        continue;
      }
      split = true;
      const edges = [
        [0, 1],
        [1, 2],
        [2, 0],
      ];
      let best = 0,
        bestLen = -1;
      edges.forEach(([a, b], i) => {
        const l = Math.hypot(...tri[a].map((v, k) => v - tri[b][k]));
        if (l > bestLen) {
          bestLen = l;
          best = i;
        }
      });
      const [a, b] = edges[best];
      const c = 3 - a - b;
      const mid = tri[a].map((v, i) => (v + tri[b][i]) / 2);
      next.push([tri[a], mid, tri[c]], [mid, tri[b], tri[c]]);
    }
    queue = next;
    if (!split) break;
  }
  const out = new Float32Array(queue.length * 9);
  queue.forEach((tri, t) => {
    tri.forEach((p, i) => out.set(p, t * 9 + i * 3));
  });
  return out;
}

// The display mesh: subdivided surface, plus one stress value per point.
export function buildStressMesh({
  positions,
  indices,
  solution,
  mmPerUnit = 10,
  edgesPerVoxel = 1,
}) {
  const maxEdge = (solution.grid.h * edgesPerVoxel) / mmPerUnit;
  const soup = subdivideSoup(positions, indices, maxEdge);
  const stress = new Float32Array(soup.length / 3);
  for (let v = 0; v < stress.length; v++)
    stress[v] = sampleField(
      solution,
      soup[v * 3] * mmPerUnit,
      soup[v * 3 + 1] * mmPerUnit,
      soup[v * 3 + 2] * mmPerUnit,
    );
  return { positions: soup, stress };
}
