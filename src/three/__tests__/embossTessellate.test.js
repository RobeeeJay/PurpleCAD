import { describe, it, expect } from "vitest";
import {
  delaunay,
  meshGlyphCaps,
  prismFromLoops,
} from "../embossTessellate.js";

const square = (s = 1) => [
  {
    outer: [
      { x: -s, y: -s },
      { x: s, y: -s },
      { x: s, y: s },
      { x: -s, y: s },
    ],
    holes: [],
  },
];

const ring = (cx, cy, r, n, cw = false) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = ((cw ? -1 : 1) * (2 * Math.PI * i)) / n;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
};

const triArea = (P, a, b, c) =>
  Math.abs(
    (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) -
      (P[c][0] - P[a][0]) * (P[b][1] - P[a][1]),
  ) / 2;

const longestEdge = (P, tris) => {
  let m = 0;
  for (const [a, b, c] of tris)
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ])
      m = Math.max(m, Math.hypot(P[u][0] - P[v][0], P[u][1] - P[v][1]));
  return m;
};

describe("embossTessellate", () => {
  it("delaunay: a 4×4 grid → 2 triangles per cell", () => {
    const pts = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) pts.push([x, y]);
    expect(delaunay(pts).length).toBe(18); // 3×3 cells × 2
  });

  it("caps cover the region area with no long sliver triangles", () => {
    const maxEdge = 0.2;
    const { points, tris } = meshGlyphCaps(square(1), maxEdge);
    let area = 0;
    for (const [a, b, c] of tris) area += triArea(points, a, b, c);
    expect(area).toBeCloseTo(4, 1); // the 2×2 square
    // The whole point: no long triangles.  Quality meshing keeps every edge near
    // the target step (vs ear-clip slivers that span the whole glyph).
    expect(longestEdge(points, tris)).toBeLessThan(maxEdge * 2);
  });

  it("respects a hole (a glyph counter) — nothing meshed inside it", () => {
    const loops = [
      { outer: ring(0, 0, 2, 24), holes: [ring(0, 0, 0.8, 16, true)] },
    ];
    const { points, tris } = meshGlyphCaps(loops, 0.2);
    const inHole = tris.some(([a, b, c]) => {
      const cx = (points[a][0] + points[b][0] + points[c][0]) / 3;
      const cy = (points[a][1] + points[b][1] + points[c][1]) / 3;
      return Math.hypot(cx, cy) < 0.8;
    });
    expect(inHole).toBe(false);
  });

  it("coarsens the step to stay under the point budget for a big region", () => {
    const fine = meshGlyphCaps(square(20), 0.05); // 40×40 area, absurdly fine step
    expect(fine.step).toBeGreaterThan(0.05); // budget forced a coarser step
    expect(fine.points.length).toBeLessThan(2500);
  });

  it("prismFromLoops is a watertight manifold (every edge shared by two faces)", () => {
    const { positions, indices } = prismFromLoops(square(1), 0.3, 0.2);
    expect(positions.every(Number.isFinite)).toBe(true);
    const ec = new Map();
    for (let i = 0; i < indices.length; i += 3) {
      const t = [indices[i], indices[i + 1], indices[i + 2]];
      for (const [a, b] of [
        [t[0], t[1]],
        [t[1], t[2]],
        [t[2], t[0]],
      ]) {
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        ec.set(k, (ec.get(k) || 0) + 1);
      }
    }
    expect([...ec.values()].filter((c) => c !== 2).length).toBe(0);
  });

  it("meshGlyphCaps triangles never cross a concave contour (no protrusions)", () => {
    // A deep concave notch (like the counter of a '5'): the unconstrained
    // Delaunay used to CHORD across it — a triangle with its centroid inside but
    // an apex outside the glyph — which wrapped into visibly distorted relief on
    // 5/6/9. The densified boundary + crossing filter must keep every triangle
    // inside: cap area == polygon area, and no edge properly crosses the contour.
    const notched = [
      {
        outer: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
          { x: 3, y: 2 },
          { x: 0.4, y: 2 },
          { x: 0.4, y: 1.2 }, // deep narrow notch back into the shape
          { x: 2.6, y: 1.1 },
          { x: 2.6, y: 0.9 },
          { x: 0, y: 0.8 },
        ],
        holes: [],
      },
    ];
    const { points, tris } = meshGlyphCaps(notched, 0.43);
    const ring = notched[0].outer;
    let polyArea = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i],
        q = ring[(i + 1) % ring.length];
      polyArea += p.x * q.y - q.x * p.y;
    }
    polyArea = Math.abs(polyArea) / 2;
    let capArea = 0;
    for (const [a, b, c] of tris) capArea += triArea(points, a, b, c);
    expect(capArea).toBeCloseTo(polyArea, 5);
    const ori = (ax, ay, bx, by, cx, cy) =>
      (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const crosses = (p, q, a, b) => {
      const d1 = ori(a.x, a.y, b.x, b.y, p[0], p[1]);
      const d2 = ori(a.x, a.y, b.x, b.y, q[0], q[1]);
      const d3 = ori(p[0], p[1], q[0], q[1], a.x, a.y);
      const d4 = ori(p[0], p[1], q[0], q[1], b.x, b.y);
      return (
        ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) &&
        ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12))
      );
    };
    let crossing = 0;
    for (const [a, b, c] of tris)
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ])
        for (let i = 0; i < ring.length; i++)
          if (
            crosses(points[u], points[v], ring[i], ring[(i + 1) % ring.length])
          )
            crossing++;
    expect(crossing).toBe(0);
  });

  it("prismFromLoops has CONSISTENT winding on a holed glyph (correct normals)", () => {
    // Square with a square hole (like O/A/e).  Regression: the raw cap+wall mesh
    // wound some faces backward → the sewn solid was watertight but had reversed
    // faces (wrong render normals) that OCC's global orient couldn't fix.  A
    // consistently-wound closed mesh uses every DIRECTED edge exactly once.
    const holed = [
      {
        outer: [
          { x: -2, y: -2 },
          { x: 2, y: -2 },
          { x: 2, y: 2 },
          { x: -2, y: 2 },
        ],
        holes: [
          [
            { x: -1, y: -1 },
            { x: -1, y: 1 },
            { x: 1, y: 1 },
            { x: 1, y: -1 },
          ],
        ],
      },
    ];
    const { indices } = prismFromLoops(holed, 1, 0.5);
    const dir = new Map();
    for (let i = 0; i < indices.length; i += 3) {
      const t = [indices[i], indices[i + 1], indices[i + 2]];
      for (const [a, b] of [
        [t[0], t[1]],
        [t[1], t[2]],
        [t[2], t[0]],
      ])
        dir.set(`${a}_${b}`, (dir.get(`${a}_${b}`) || 0) + 1);
    }
    expect([...dir.values()].filter((c) => c !== 1).length).toBe(0);
  });
});
