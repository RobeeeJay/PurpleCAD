// Shared "frame a scene into the view" maths, used by both the Reset-view /
// Home button (useViewportCamera) and the project-thumbnail capture
// (cameraControls) so a thumbnail frames identically to the default view.

import * as THREE from "three";
import { primitiveDimensions } from "./sceneObjects/dimensions.js";

// Local-space silhouette samples for the round primitives.  Their meshes are
// rendered by an analytic shader inside an enclosing BoxGeometry hull, so the
// mesh AABB is the 2r cube — much larger than the visible shape.  Framing that
// hull leaves spheres/cylinders/cones filling barely half the view.  Sampling
// the true surface lets the fit frame what the user actually sees.  Returns
// null for anything that isn't a round primitive (use its real AABB instead).
export function analyticLocalPoints(item) {
  const t = item?.type;
  if (t !== "sphere" && t !== "cylinder" && t !== "cone" && t !== "torus")
    return null;
  const d = primitiveDimensions(item);
  const pts = [];
  const RING = 24;
  if (t === "sphere") {
    const r = d.radius;
    for (let a = 0; a < RING; a++) {
      const th = (a / RING) * 2 * Math.PI;
      for (const ph of [Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.75])
        pts.push(
          new THREE.Vector3(
            r * Math.sin(ph) * Math.cos(th),
            r * Math.cos(ph),
            r * Math.sin(ph) * Math.sin(th),
          ),
        );
    }
    pts.push(new THREE.Vector3(0, r, 0), new THREE.Vector3(0, -r, 0));
  } else if (t === "cylinder") {
    const r = d.radius;
    const h = d.height / 2;
    for (let a = 0; a < RING; a++) {
      const th = (a / RING) * 2 * Math.PI;
      const x = r * Math.cos(th);
      const z = r * Math.sin(th);
      pts.push(new THREE.Vector3(x, h, z), new THREE.Vector3(x, -h, z));
    }
  } else if (t === "cone") {
    const rb = d.radiusBottom;
    const rt = d.radiusTop;
    const h = d.height / 2;
    for (let a = 0; a < RING; a++) {
      const th = (a / RING) * 2 * Math.PI;
      const c = Math.cos(th);
      const s = Math.sin(th);
      pts.push(
        new THREE.Vector3(rb * c, -h, rb * s),
        new THREE.Vector3(rt * c, h, rt * s),
      );
    }
  } else {
    // torus: ring in the XZ plane, tube radius `minor` reaching ±minor in Y
    const R = d.major;
    const m = d.minor;
    for (let a = 0; a < RING; a++) {
      const th = (a / RING) * 2 * Math.PI;
      const c = Math.cos(th);
      const s = Math.sin(th);
      pts.push(
        new THREE.Vector3((R + m) * c, 0, (R + m) * s),
        new THREE.Vector3((R - m) * c, 0, (R - m) * s),
        new THREE.Vector3(R * c, m, R * s),
        new THREE.Vector3(R * c, -m, R * s),
      );
    }
  }
  return pts;
}

// Push a Box3's 8 world corners into `out`.
export function boxCorners(box, out = []) {
  for (let i = 0; i < 8; i++)
    out.push(
      new THREE.Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ),
    );
  return out;
}

// World-space fit points for one solid mesh: the analytic silhouette for a
// round primitive, else the mesh's real AABB corners.
export function meshFitPoints(item, mesh, out = []) {
  mesh.updateMatrixWorld(true);
  const local = analyticLocalPoints(item);
  if (local) {
    const m = mesh.matrixWorld;
    for (const lp of local) out.push(lp.clone().applyMatrix4(m));
  } else {
    const b = new THREE.Box3().setFromObject(mesh);
    if (!b.isEmpty()) boxCorners(b, out);
  }
  return out;
}

// Frame a world-space point cloud so its tightest extent fills `fill` of the
// USABLE view rectangle (0.9 == 90%, leaving a small margin) with the object
// centred in that rectangle — same isometric direction `dir`, up = +Y.  The
// usable rectangle is given in NDC as `frame` = { cx, cy, halfW, halfH } (the
// centre and half-extents of the un-obscured area; default is the whole
// [-1,1] frame).  Returns { target, distance, endZoom } (endZoom for ortho).
//
// Perspective is the hard case: the world-bbox centre does NOT project to the
// frame centre for a spread-out / asymmetric layout, so a naive "frame the max
// |offset| about the bbox centre" leaves everything jammed against one edge.
// We instead solve for the exact minimum camera distance D and a lateral
// offset (a,b) of the view centre such that every point lands inside the target
// rectangle.  Feasibility at a given D is a simple interval test per axis;
// binary-search D for the tightest fit, then balance each axis so the projected
// extent is centred on the rectangle.  Provably tight and never clips.
export function fitPointsToView(
  pts,
  dir,
  camera,
  fill,
  frame = { cx: 0, cy: 0, halfW: 1, halfH: 1 },
) {
  const zAxis = dir.clone().normalize();
  const xAxis = new THREE.Vector3()
    .crossVectors(new THREE.Vector3(0, 1, 0), zAxis)
    .normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  const origin = new THREE.Box3()
    .setFromPoints(pts)
    .getCenter(new THREE.Vector3());

  // Target NDC window per axis: centre and half-range (fill of the usable half).
  const Rx = fill * frame.halfW;
  const Ry = fill * frame.halfH;
  const cX = frame.cx;
  const cY = frame.cy;

  // View-frame coordinates of every point relative to `origin`.
  const U = [];
  const V = [];
  const W = [];
  const p = new THREE.Vector3();
  let maxW = -Infinity;
  let minW = Infinity;
  for (const q of pts) {
    p.copy(q).sub(origin);
    U.push(p.dot(xAxis));
    V.push(p.dot(yAxis));
    const w = p.dot(zAxis);
    W.push(w);
    if (w > maxW) maxW = w;
    if (w < minW) minW = w;
  }
  const wc = (minW + maxW) / 2;

  if (camera.isOrthographicCamera) {
    // Parallel projection: exact centred fit in one shot, no depth coupling.
    let uMn = Infinity,
      uMx = -Infinity,
      vMn = Infinity,
      vMx = -Infinity;
    for (let i = 0; i < U.length; i++) {
      if (U[i] < uMn) uMn = U[i];
      if (U[i] > uMx) uMx = U[i];
      if (V[i] < vMn) vMn = V[i];
      if (V[i] > vMx) vMx = V[i];
    }
    const spanU = Math.max(uMx - uMn, 1e-4);
    const spanV = Math.max(vMx - vMn, 1e-4);
    const fw = camera.right - camera.left;
    const fh = camera.top - camera.bottom;
    // Zoom so the cloud's projected half-extent reaches the target half-range.
    const endZoom = Math.min((Rx * fw) / spanU, (Ry * fh) / spanV);
    // Offset the look-at point so the cloud centre lands on the window centre.
    const a = (uMn + uMx) / 2 - (cX * fw) / (2 * endZoom);
    const b = (vMn + vMx) / 2 - (cY * fh) / (2 * endZoom);
    const target = origin
      .clone()
      .addScaledVector(xAxis, a)
      .addScaledVector(yAxis, b)
      .addScaledVector(zAxis, wc);
    return { target, distance: maxW - wc + 5, endZoom };
  }

  // Perspective.  ndc for a point at depth w and lateral u, camera at depth D
  // and lateral offset a:  ndc = (u - a) / ((D - w) * tan).  Requiring
  // ndc ∈ [c - R, c + R] gives a feasible interval for a; the axis is fittable
  // at D iff that interval is non-empty (and every point is in front of the eye).
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const tanH = tanV * camera.aspect;
  const interval = (arr, tan, D, c, R) => {
    let lo = -Infinity;
    let hi = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const m = tan * (D - W[i]);
      if (m <= 0) return null; // point at/behind the eye
      lo = Math.max(lo, arr[i] - (c + R) * m);
      hi = Math.min(hi, arr[i] - (c - R) * m);
    }
    return lo <= hi ? [lo, hi] : null;
  };
  const feasible = (D) =>
    D > maxW &&
    !!interval(U, tanH, D, cX, Rx) &&
    !!interval(V, tanV, D, cY, Ry);

  const bs = new THREE.Sphere();
  new THREE.Box3().setFromPoints(pts).getBoundingSphere(bs);
  let dHi =
    maxW +
    (bs.radius / (Math.min(Rx, Ry) * Math.min(tanH, tanV))) * 2 +
    bs.radius +
    1;
  while (!feasible(dHi)) dHi *= 2;
  let dLo = maxW + 1e-6;
  for (let it = 0; it < 60; it++) {
    const dm = (dLo + dHi) / 2;
    if (feasible(dm)) dHi = dm;
    else dLo = dm;
  }
  const D = dHi;

  // Balance each axis: pick the offset that centres the projected extent on the
  // window centre (make max−c == c−min).  The binding axis interval collapses
  // to a point (already centred); the loose axis gets centred here.
  const balance = (arr, tan, c, R) => {
    const iv = interval(arr, tan, D, c, R);
    let lo = iv[0];
    let hi = iv[1];
    for (let it = 0; it < 50; it++) {
      const a = (lo + hi) / 2;
      let gMax = -Infinity;
      let gMin = Infinity;
      for (let i = 0; i < arr.length; i++) {
        const n = (arr[i] - a) / ((D - W[i]) * tan);
        if (n > gMax) gMax = n;
        if (n < gMin) gMin = n;
      }
      // Increasing a lowers every ndc; drive the midpoint toward c.
      if (gMax + gMin > 2 * c) lo = a;
      else hi = a;
    }
    return (lo + hi) / 2;
  };
  const a = balance(U, tanH, cX, Rx);
  const b = balance(V, tanV, cY, Ry);
  const target = origin
    .clone()
    .addScaledVector(xAxis, a)
    .addScaledVector(yAxis, b)
    .addScaledVector(zAxis, wc);
  return { target, distance: D - wc, endZoom: null };
}
