// A component's motion: the pure maths behind the motion dialog and the
// animation.  A component turns about an axis (rotation) or slides along one
// (axis), swinging back and forth between its negative and positive extents,
// starting from its rest pose and moving positive first.  All positions are
// world space, in scene units; angles are degrees and distances mm, as the
// dialog shows them.

import * as THREE from "three";
import { MM_PER_UNIT } from "./sceneObjects/dimensions.js";

const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);
const plain = (v) => ({ x: v.x, y: v.y, z: v.z });

// The axis a picked piece of geometry defines, in world space.  `pick` is a
// sub-geometry selection as the 3D view records it (in the mesh's local frame)
// and `matrixWorld` the picked mesh's world matrix:
//   - a flat face: through its centre, along its normal;
//   - a curved chain of edges (a hole's rim, a boss's edge): through the
//     circle's centre, along the circle's normal;
//   - a straight edge: along the edge.
// Returns { origin, dir, kind } or null when the pick defines no axis.
export function referenceFromPick(pick, matrixWorld) {
  const m = new THREE.Matrix4().fromArray(matrixWorld);
  const toWorld = (p) => v3(p).applyMatrix4(m);
  const face = pick?.faces?.[0];
  if (face) {
    const dir = new THREE.Vector3(face.nx, face.ny, face.nz)
      .transformDirection(m)
      .normalize();
    if (face.cx == null) return null;
    const origin = toWorld({ x: face.cx, y: face.cy, z: face.cz });
    return { origin: plain(origin), dir: plain(dir), kind: "face" };
  }
  const edges = pick?.edges || [];
  if (!edges.length) return null;
  const pts = [];
  for (const e of edges) {
    pts.push(toWorld({ x: e.ax, y: e.ay, z: e.az }));
    pts.push(toWorld({ x: e.bx, y: e.by, z: e.bz }));
  }
  const a = pts[0];
  const b = pts[pts.length - 1];
  // A chain that bends is a curve: its three well-spread points fix a circle.
  const mid = pts[Math.floor(pts.length / 2)];
  const circle = edges.length >= 3 ? circleThrough(a, mid, pts) : null;
  if (circle) return { ...circle, kind: "circle" };
  const dir = new THREE.Vector3().subVectors(b, a);
  if (dir.lengthSq() < 1e-18) return null;
  return { origin: plain(a), dir: plain(dir.normalize()), kind: "edge" };
}

// The circle through a chain of points, from its first, middle and the point
// furthest from both (a full ring's last point is back at the first).  Null
// when the chain is straight.
function circleThrough(a, mid, pts) {
  let c = null,
    best = 0;
  for (const p of pts) {
    const d = Math.min(p.distanceTo(a), p.distanceTo(mid));
    if (d > best) {
      best = d;
      c = p;
    }
  }
  if (!c) return null;
  const ab = new THREE.Vector3().subVectors(mid, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const n = new THREE.Vector3().crossVectors(ab, ac);
  const n2 = n.lengthSq();
  if (n2 < 1e-12 * ab.lengthSq() * ac.lengthSq()) return null; // collinear
  // Circumcentre of a, mid, c.
  const centre = a.clone().add(
    new THREE.Vector3()
      .crossVectors(n, ab)
      .multiplyScalar(ac.lengthSq())
      .add(
        new THREE.Vector3().crossVectors(ac, n).multiplyScalar(ab.lengthSq()),
      )
      .multiplyScalar(1 / (2 * n2)),
  );
  return { origin: plain(centre), dir: plain(n.normalize()) };
}

// Where the motion is `seconds` after it started: a value in
// [-negative, +positive] (degrees or mm), sweeping out from 0 in the positive
// direction first and then back and forth at `speed` per second.
export function motionValueAt(motion, seconds) {
  const pos = Math.max(0, Number(motion.positive) || 0);
  const neg = Math.max(0, Number(motion.negative) || 0);
  const speed = Math.max(0, Number(motion.speed) || 0);
  const span = pos + neg;
  if (span <= 0 || speed <= 0) return 0;
  // Measured from the negative end, the motion starts `neg` along a path that
  // runs up to span and back.
  const along = (neg + speed * seconds) % (2 * span);
  return along <= span ? along - neg : pos - (along - span);
}

// The rigid transform that moves the component `value` along its motion:
// a rotation of `value` degrees about the axis, or a slide of `value` mm
// along it.
export function motionMatrix(motion, value) {
  const origin = v3(motion.axis.origin);
  const dir = v3(motion.axis.dir).normalize();
  if (motion.type === "rotation") {
    const r = new THREE.Matrix4().makeRotationAxis(
      dir,
      THREE.MathUtils.degToRad(value),
    );
    // About the axis line, not the world origin: T(o) R T(-o).
    return new THREE.Matrix4()
      .makeTranslation(origin.x, origin.y, origin.z)
      .multiply(r)
      .multiply(
        new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z),
      );
  }
  const d = dir.multiplyScalar(value / MM_PER_UNIT);
  return new THREE.Matrix4().makeTranslation(d.x, d.y, d.z);
}

// Every item inside a component, however deeply: items and components nest
// through `parentId`, which can point at a component or at another item.
export function componentMembers(items, folders, folderId) {
  const parentOf = new Map();
  for (const f of folders) parentOf.set(f.id, f.parentId ?? null);
  for (const i of items) parentOf.set(i.id, i.parentId ?? null);
  const inside = (id) => {
    const seen = new Set();
    for (
      let p = parentOf.get(id);
      p != null && !seen.has(p);
      p = parentOf.get(p)
    ) {
      if (p === folderId) return true;
      seen.add(p);
    }
    return false;
  };
  return items.filter((i) => inside(i.id)).map((i) => i.id);
}
