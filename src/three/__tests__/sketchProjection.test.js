import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  fitProjectedShapes,
  featureEdgeGraph,
  edgePolylineNear,
  decomposeFeatureEdges,
  dedupProjectedShapes,
  worldPolylineToLocal2D,
} from "../sketchProjection.js";

describe("fitProjectedShapes", () => {
  it("fits a straight run to one line", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ];
    const shapes = fitProjectedShapes(pts, { foo: 1 });
    expect(shapes).toHaveLength(1);
    expect(shapes[0].type).toBe("line");
    expect(shapes[0].x2).toBeCloseTo(3, 6);
    expect(shapes[0].foo).toBe(1); // tag merged
  });

  it("fits a sampled full circle to a circle", () => {
    const pts = [];
    for (let i = 0; i < 32; i++) {
      const t = (i / 32) * 2 * Math.PI;
      pts.push({ x: 2 + 3 * Math.cos(t), y: -1 + 3 * Math.sin(t) });
    }
    pts.push({ ...pts[0] }); // close
    const [s] = fitProjectedShapes(pts);
    expect(s.type).toBe("circle");
    expect(s.cx).toBeCloseTo(2, 3);
    expect(s.cy).toBeCloseTo(-1, 3);
    expect(s.r).toBeCloseTo(3, 3);
  });

  it("fits a quarter arc to an arc", () => {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = (i / 8) * (Math.PI / 2);
      pts.push({ x: 5 * Math.cos(t), y: 5 * Math.sin(t) });
    }
    const [s] = fitProjectedShapes(pts);
    expect(s.type).toBe("arc");
    expect(s.r).toBeCloseTo(5, 3);
  });
});

describe("featureEdgeGraph + edgePolylineNear", () => {
  it("extracts a straight edge of a box under a point", () => {
    const geo = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
    const pos = Array.from(geo.getAttribute("position").array);
    const graph = featureEdgeGraph(pos, null);
    // The top-front edge runs along x at y=1, z=1.
    const poly = edgePolylineNear(graph, { x: 0, y: 1, z: 1 });
    expect(poly).toBeTruthy();
    expect(poly.length).toBeGreaterThanOrEqual(2);
    // All points share y≈1, z≈1 (it's that one edge), spanning x in [-1,1].
    const xs = poly.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-1, 5);
    expect(Math.max(...xs)).toBeCloseTo(1, 5);
    for (const p of poly) {
      expect(p.y).toBeCloseTo(1, 5);
      expect(p.z).toBeCloseTo(1, 5);
    }
  });
});

describe("decomposeFeatureEdges", () => {
  it("keeps only the silhouette outline when given a plane normal", () => {
    // Viewed straight down +Z, the outline is the top face's 4 edges; the
    // verticals are edge-on and the bottom edges are hidden.
    const geo = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
    const pos = Array.from(geo.getAttribute("position").array);
    const graph = featureEdgeGraph(pos, null, undefined, { x: 0, y: 0, z: 1 });
    const chains = decomposeFeatureEdges(graph);
    expect(chains).toHaveLength(4);
    for (const c of chains) for (const p of c) expect(p.z).toBeCloseTo(1, 5);
  });

  it("drops internal (front-on-front) edges, keeping only the silhouette", () => {
    // Viewed from a corner (1,1,1), a cube's outline is a 6-edge hexagon; the
    // three front 'Y' edges (between two front faces) are internal and dropped.
    const geo = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
    const pos = Array.from(geo.getAttribute("position").array);
    const s = 1 / Math.sqrt(3);
    const graph = featureEdgeGraph(pos, null, undefined, { x: s, y: s, z: s });
    expect(decomposeFeatureEdges(graph)).toHaveLength(6);
  });

  it("splits a box into its 12 edges", () => {
    const geo = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
    const pos = Array.from(geo.getAttribute("position").array);
    const graph = featureEdgeGraph(pos, null);
    const chains = decomposeFeatureEdges(graph);
    expect(chains).toHaveLength(12);
    // Each chain is a straight box edge of length 2.
    for (const c of chains) {
      const a = c[0],
        b = c[c.length - 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      expect(len).toBeCloseTo(2, 5);
    }
  });
});

describe("dedupProjectedShapes", () => {
  it("drops coincident (either-orientation) lines, zero-length lines, and dup arcs", () => {
    const shapes = [
      { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
      { type: "line", x1: 4, y1: 0, x2: 0, y2: 0 }, // reverse → coincident
      { type: "line", x1: 2, y1: 2, x2: 2, y2: 2 }, // zero length
      { type: "line", x1: 0, y1: 0, x2: 0, y2: 4 }, // distinct
      { type: "circle", cx: 1, cy: 1, r: 3 },
      { type: "circle", cx: 1, cy: 1, r: 3 }, // dup
    ];
    const out = dedupProjectedShapes(shapes);
    expect(out).toHaveLength(3); // one of the coincident lines, the distinct line, one circle
    expect(out.filter((s) => s.type === "line")).toHaveLength(2);
    expect(out.filter((s) => s.type === "circle")).toHaveLength(1);
  });
});

describe("worldPolylineToLocal2D", () => {
  it("drops world points onto an XY sketch plane", () => {
    const origin = new THREE.Vector3(0, 0, 5);
    const quat = new THREE.Quaternion(); // identity → plane normal +Z
    const local = worldPolylineToLocal2D(
      [
        { x: 1, y: 2, z: 9 },
        { x: 3, y: 4, z: -2 },
      ],
      origin,
      quat,
    );
    // x,y preserved; z (out-of-plane) dropped.
    expect(local[0]).toEqual({ x: 1, y: 2 });
    expect(local[1]).toEqual({ x: 3, y: 4 });
  });
});
