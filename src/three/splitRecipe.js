// Split steps saved before pieces carried a re-cut recipe: recover the recipe
// from the pieces themselves, so a document made earlier also follows a
// resolution change.  The cut plane is where both pieces have a face, facing
// each other -- each piece's cap -- and it must separate them.
import * as THREE from "three";
import { unpackGeometryData } from "../store/geometryPack.js";

// World-space triangles of a piece as it was created (rotation 0, scale 1).
function worldTriangles(item) {
  const g = unpackGeometryData(item.geometryData);
  if (!g?.positions?.length) return null;
  const P = g.positions;
  const I = g.indices?.length ? g.indices : [...Array(P.length / 3).keys()];
  const o = item.position || { x: 0, y: 0, z: 0 };
  return { P, I, o };
}

// Area on each plane the piece has faces in, keyed by normal and offset.
function planeAreas({ P, I, o }, flip) {
  const areas = new Map();
  for (let t = 0; t < I.length; t += 3) {
    const v = [0, 1, 2].map((k) => [
      P[I[t + k] * 3] + o.x,
      P[I[t + k] * 3 + 1] + o.y,
      P[I[t + k] * 3 + 2] + o.z,
    ]);
    const e1 = v[1].map((x, k) => x - v[0][k]);
    const e2 = v[2].map((x, k) => x - v[0][k]);
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const len = Math.hypot(...n);
    if (len < 1e-12) continue;
    const s = flip ? -1 / len : 1 / len;
    const u = n.map((x) => x * s);
    const d = u[0] * v[0][0] + u[1] * v[0][1] + u[2] * v[0][2];
    const key = [...u.map((x) => x.toFixed(3)), d.toFixed(3)].join(",");
    const a = areas.get(key) ?? { area: 0, n: u, d };
    a.area += len / 2;
    areas.set(key, a);
  }
  return areas;
}

// Signed distances of every vertex from the plane, as [min, max].
function extent({ P, o }, n, d) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const s =
      (P[i] + o.x) * n[0] +
      (P[i + 1] + o.y) * n[1] +
      (P[i + 2] + o.z) * n[2] -
      d;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return [lo, hi];
}

// The plane a Split cut `a` (its +normal side) from `b` along, in the form the
// Split dialog stores ({ position, rotation }), or null when no plane both
// pieces share separates them.
export function inferSplitPlane(a, b) {
  const ta = worldTriangles(a);
  const tb = worldTriangles(b);
  if (!ta || !tb) return null;
  const capsA = planeAreas(ta, false);
  // b's cap faces the other way: flip its normals so the keys match.
  const capsB = planeAreas(tb, true);
  let best = null;
  for (const [key, ca] of capsA) {
    const cb = capsB.get(key);
    if (!cb) continue;
    const shared = Math.min(ca.area, cb.area);
    if (!best || shared > best.shared) best = { shared, ...ca };
  }
  if (!best) return null;
  // a's cap faces b, so the plane's normal -- pointing into a -- is its
  // reverse.
  const n = best.n.map((x) => -x);
  const d = -best.d;
  const tol = 1e-3;
  const [aLo] = extent(ta, n, d);
  const [, bHi] = extent(tb, n, d);
  if (aLo < -tol || bHi > tol) return null;
  const normal = new THREE.Vector3(...n).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    normal,
  );
  const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
  return {
    position: { x: normal.x * d, y: normal.y * d, z: normal.z * d },
    rotation: { x: e.x, y: e.y, z: e.z },
  };
}

// Give each recipe-less plane Split step's pieces their re-cut recipe.
// Unstamped, so the first recalc re-cuts them at the current resolution.  A
// recipe written before pieces recorded their centre gets it here: the
// position a Split step stores for a piece is where its mesh is centred.
export function backfillSplitRecipes(history) {
  let changed = false;
  const out = history.map((entry) => {
    const inst = entry.instruction;
    if (
      inst?.type === "createGroup" &&
      inst.items?.some(
        (i) => i.regenerator?.kind === "split" && !i.regenerator.center,
      )
    ) {
      changed = true;
      return {
        ...entry,
        instruction: {
          ...inst,
          items: inst.items.map((i) =>
            i.regenerator?.kind === "split" && !i.regenerator.center
              ? { ...i, regenerator: { ...i.regenerator, center: i.position } }
              : i,
          ),
        },
      };
    }
    if (
      inst?.type !== "createGroup" ||
      inst.splitFrom == null ||
      inst.items?.length !== 2 ||
      inst.items.some((i) => i.regenerator || i.type !== "csg")
    )
      return entry;
    const [a, b] = inst.items;
    const plane = inferSplitPlane(a, b);
    if (!plane) return entry;
    changed = true;
    const recipe = (side, center) => ({
      kind: "split",
      sourceId: inst.splitFrom,
      plane,
      side,
      center,
      regeneratedAt: null,
    });
    return {
      ...entry,
      instruction: {
        ...inst,
        items: [
          { ...a, regenerator: recipe("a", a.position) },
          { ...b, regenerator: recipe("b", b.position) },
        ],
      },
    };
  });
  return changed ? out : history;
}
