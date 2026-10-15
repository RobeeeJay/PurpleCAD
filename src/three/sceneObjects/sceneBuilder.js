// Builds the THREE.Mesh for each item in the scene, attaches custom
// raycasters for the analytic primitives, and lays out per-item state
// (originalMaterialsRef, the extrude-centroid offset for drag commits).
//
// Re-runs from scratch every time `items` changes — cheap because the
// per-item geometry is bounded (a box-hull for primitives + the
// pre-tessellated `geometryData` for csg results).

import * as THREE from "three";
import {
  createMaterial,
  resolveItemMaterial,
  applyMaterialToMesh,
} from "../objectMaterials.js";
import { resolveItemDepth } from "../geometryParams.js";
import { DEFAULT_MATERIAL } from "../materialPresets.js";
import {
  regionsWithShapes,
  regionsForProfile,
  polyContainsPoint,
  polyCentroid,
  polyAreaCentroid,
  polyArea,
  profileAnchor,
  withWinding,
} from "./closedLoops.js";
import {
  DEFAULT_MESH_COLOR,
  WIREFRAME_EDGE_COLOR,
  NO_EMISSIVE,
} from "../theme.js";
import { primitiveDimensions } from "./dimensions.js";

// Green so the revealed plane stands out clearly against the model.
const GRID_MINOR_COLOR = 0x2ecc71;
const GRID_MAJOR_COLOR = 0x55ff88;

// A two-tier grid laid in the sketch plane's local XY, spanning the 1000-unit
// reference plane.  Added as a child of the (hover-revealed) plane mesh so it
// inherits the plane's transform and visibility — when the plane appears on
// hover the grid makes its position and orientation in space obvious.
function buildSketchPlaneGrid() {
  const half = 500; // matches the PlaneGeometry(1000, 1000)
  const majorStep = 10; // 10 scene units = 100 mm
  const minorPts = [];
  const majorPts = [];
  for (let i = -half; i <= half; i++) {
    const target = i % majorStep === 0 ? majorPts : minorPts;
    target.push(i, -half, 0, i, half, 0); // line parallel to local Y
    target.push(-half, i, 0, half, i, 0); // line parallel to local X
  }
  const group = new THREE.Group();
  const tier = (pts, color, opacity) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(pts), 3),
    );
    return new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    );
  };
  group.add(tier(minorPts, GRID_MINOR_COLOR, 0.45));
  group.add(tier(majorPts, GRID_MAJOR_COLOR, 0.85));
  return group;
}

// The display geometry for a baked mesh.  Normals are computed here when not
// stored (OCC results store none): over an OCC tessellation that is right,
// since its vertices are shared only WITHIN a face, so curved faces shade
// smooth and edges between faces stay sharp.  A WELDED mesh (`flat`: a welded
// STL import, a mesh split) shares vertices ACROSS its sharp edges too, and
// averaging there smears every corner.  Those meshes were triangle soups --
// three private vertices per triangle -- and rendered flat and crisp, so they
// are split apart again for display only, which gives exactly the look they
// had.  Everything unmarked keeps its current look.
export function csgDisplayGeometry({ positions, normals, indices, flat }) {
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(positions), 3),
  );
  if (normals)
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(new Float32Array(normals), 3),
    );
  if (indices)
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  if (!normals) {
    if (flat && geometry.index) geometry = geometry.toNonIndexed();
    geometry.computeVertexNormals();
  }
  return geometry;
}

// THREE.ExtrudeGeometry draws one flat quad per polygon edge.  Where those
// edges sample an exact curve (the profile's curves2D), the wall takes the
// curve's own normal instead, so a plain extruded cylinder shades round, as
// its OCC body does once a boolean has tessellated it.  `loops` are the
// profile's loops in sketch coordinates, `centre` what the geometry was
// shifted by.
export function smoothCurvedWalls(geometry, loops, centre) {
  const key = (x, y) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
  const edgeRun = new Map();
  for (const { polygon, runs } of loops) {
    const n = polygon.length;
    for (const run of runs || [])
      for (let k = 0; k < run.count; k++) {
        const a = polygon[(run.start + k) % n];
        const b = polygon[(run.start + k + 1) % n];
        const ka = key(a.x - centre.x, a.y - centre.y);
        const kb = key(b.x - centre.x, b.y - centre.y);
        edgeRun.set(`${ka}|${kb}`, run);
        edgeRun.set(`${kb}|${ka}`, run);
      }
  }
  if (edgeRun.size === 0) return;
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  // A wall triangle spans one polygon edge: two distinct points in plan.
  const walls = [];
  const bezierSum = new Map();
  for (let t = 0; t < pos.count; t += 3) {
    const ks = [t, t + 1, t + 2].map((i) => key(pos.getX(i), pos.getY(i)));
    const plan = [...new Set(ks)];
    if (plan.length !== 2) continue;
    const run = edgeRun.get(`${plan[0]}|${plan[1]}`);
    if (!run) continue;
    const facet = [nrm.getX(t), nrm.getY(t)];
    walls.push({ t, run, ks, facet });
    // A bezier or interp has no closed-form normal here: average its facets.
    if (run.type === "bezier" || run.type === "interp")
      for (const k of plan) {
        const s = bezierSum.get(k) || [0, 0];
        bezierSum.set(k, [s[0] + facet[0], s[1] + facet[1]]);
      }
  }
  for (const { t, run, ks, facet } of walls)
    for (let j = 0; j < 3; j++) {
      const x = pos.getX(t + j) + centre.x;
      const y = pos.getY(t + j) + centre.y;
      let [nx, ny] =
        run.type === "arc"
          ? [x - run.cx, y - run.cy]
          : run.type === "ellipse"
            ? [(x - run.cx) / run.rx ** 2, (y - run.cy) / run.ry ** 2]
            : bezierSum.get(ks[j]);
      const len = Math.hypot(nx, ny);
      if (!(len > 0)) continue;
      // Outward, as the facet faces: a bore's wall faces its axis.
      const sign = nx * facet[0] + ny * facet[1] < 0 ? -1 : 1;
      nrm.setXYZ(t + j, (sign * nx) / len, (sign * ny) / len, 0);
    }
  nrm.needsUpdate = true;
}

export function buildSceneObjects(
  items,
  scene,
  objectsRef,
  originalMaterialsRef,
  curveSegments = 32,
  precision = null,
  defaultMaterial = DEFAULT_MATERIAL,
) {
  // Incremental rebuild: a csg mesh whose geometryData REFERENCE is unchanged
  // (only moved/rotated/scaled — a gizmo release, a re-anchored position) is
  // reused as-is.  Rebuilding it means re-uploading the BufferGeometry AND
  // recomputing its EdgesGeometry child — on a document with dense texture
  // meshes that was a 5-second main-thread freeze after every drag.
  const previousMeshes = objectsRef.current;
  const previousMaterials = originalMaterialsRef.current;
  const reused = new Set();
  objectsRef.current = {};
  originalMaterialsRef.current = {};

  items.forEach((item) => {
    const prev = previousMeshes[item.id];
    if (
      item.type === "csg" &&
      prev &&
      item.geometryData &&
      prev.userData.geometrySource === item.geometryData
    ) {
      const p = item.position;
      const rot = item.rotation;
      const sc = item.scale;
      if (rot) prev.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
      prev.scale.set(sc?.x ?? 1, sc?.y ?? 1, sc?.z ?? 1);
      prev.position.set(p ? p.x : 0, p ? p.y : 2, p ? p.z : 0);
      prev.visible = item.visible !== false;
      // Material props may have changed independently of the geometry.
      const mp = resolveItemMaterial(item, items, defaultMaterial);
      applyMaterialToMesh(prev, item, mp);
      objectsRef.current[item.id] = prev;
      originalMaterialsRef.current[item.id] = {
        ...(previousMaterials[item.id] || {}),
        color: new THREE.Color(mp.color ?? DEFAULT_MESH_COLOR),
        metalness: mp.metalness ?? 0.3,
        roughness: mp.roughness ?? 0.5,
        opacity: mp.opacity ?? 1,
        clearcoat: mp.clearcoat ?? 0,
        clearcoatRoughness: mp.clearcoatRoughness ?? 0,
        emissive: new THREE.Color(NO_EMISSIVE),
      };
      reused.add(prev);
      return;
    }
    let geometry;
    let extrudeLocalOffset = null; // set by the extrude case; used for mesh positioning
    switch (item.type) {
      case "cube": {
        const d = item.dimensions || {};
        geometry = new THREE.BoxGeometry(
          d.width || 2,
          d.height || 2,
          d.depth || 2,
        );
        break;
      }
      case "sphere": {
        const r = primitiveDimensions(item).radius;
        geometry = new THREE.BoxGeometry(2 * r, 2 * r, 2 * r);
        break;
      }
      case "cylinder": {
        const c = primitiveDimensions(item);
        geometry = new THREE.BoxGeometry(2 * c.radius, c.height, 2 * c.radius);
        break;
      }
      case "torus": {
        const tr = primitiveDimensions(item);
        const o = 2 * (tr.major + tr.minor);
        geometry = new THREE.BoxGeometry(o, 2 * tr.minor, o);
        break;
      }
      case "cone": {
        const cn = primitiveDimensions(item);
        const o = 2 * Math.max(cn.radiusBottom, cn.radiusTop);
        geometry = new THREE.BoxGeometry(o, cn.height, o);
        break;
      }
      case "sketch":
        // Large so that, when revealed on hover, the plane reads as an infinite
        // reference surface spanning the view rather than a small card.  It is
        // hidden by default (renderMode) — only the sketch geometry shows.
        geometry = new THREE.PlaneGeometry(1000, 1000);
        break;
      case "plane":
        geometry = new THREE.PlaneGeometry(6, 6);
        break;
      case "csg": {
        if (!item.geometryData) return;
        geometry = csgDisplayGeometry(item.geometryData);
        break;
      }
      case "extrude": {
        const profile = item.profile;
        if (!profile) return;
        let poly = profile.polygon2D;
        let holePolys = profile.holes || [];
        let curves = profile.curves2D;
        // Recompute polygon and holes live from the sketch so edits propagate.
        if (profile.sketchId != null) {
          const sketchItem = items.find((si) => si.id === profile.sketchId);
          if (sketchItem && sketchItem.shapes && sketchItem.shapes.length > 0) {
            // Every region, roots and descendants alike, so a sub-region
            // like the part of a circle inside a rectangle can be matched —
            // narrowed to the profile's own shape where it names one (a cog
            // or a text glyph), which survives that shape being moved.
            const allEntries = regionsForProfile(
              regionsWithShapes(sketchItem.shapes, curveSegments, precision),
              profile,
            );
            if (allEntries.length > 0) {
              // profileAnchor drops a stale click anchor — one a sketch edit
              // has left outside its own polygon — so a shape drawn over that
              // point later can't capture this extrude (mirrors
              // extrudeWithLivePolygon).
              const { pc, inside } = profileAnchor(profile);
              // Use polyContainsPoint rather than nearest-centroid
              // distance so that the match is resolution-independent.
              // At higher curve segment counts the arithmetic-mean
              // centroid of arc-dominated polygons drifts outside the
              // polygon itself, causing the distance-based search to
              // pick the wrong entry.  A geometric interior point stays
              // inside the same region regardless of how many segments
              // the arc is split into.
              let match = allEntries[0];
              if (pc) {
                let containing = inside
                  ? allEntries.filter((g) => polyContainsPoint(g.polygon, pc))
                  : [];
                // A ring's inner loop is emitted BOTH as the outer entry's hole
                // AND as a standalone disc with the same centroid; the area
                // tiebreak (vs the stale stored area) then picks the disc after
                // a resize, showing a solid inner cylinder.  If the stored
                // profile was a ring (had holes), keep only entries that also
                // have holes.  (Mirrors extrudeWithLivePolygon.)
                if (holePolys.some((h) => h.length >= 3)) {
                  const withHoles = containing.filter((g) =>
                    (g.holes || []).some((h) => h.length >= 3),
                  );
                  if (withHoles.length > 0) containing = withHoles;
                }
                if (containing.length > 0) {
                  // Pick the polygon whose area is closest to the
                  // stored profile's area rather than the smallest one.
                  // polyCentroid is biased by arc vertex density and
                  // can land inside a neighbouring smaller polygon (eg
                  // a rect-remainder centroid drifting into the lens
                  // it borders, or a ring centroid sitting at the inner
                  // circle centre).  Area proximity is resolution-
                  // independent and reliably identifies the same
                  // geometric region across tessellation changes.
                  const targetArea = polyArea(poly);
                  match = containing.reduce((best, g) => {
                    const da = Math.abs(polyArea(g.polygon) - targetArea);
                    const db = Math.abs(polyArea(best.polygon) - targetArea);
                    return da < db ? g : best;
                  });
                } else {
                  // Fall back to nearest centroid when nothing contains
                  // the stored point (eg sketch was heavily edited).
                  match = allEntries.reduce(
                    (best, g) => {
                      const c = polyCentroid(g.polygon);
                      const d = Math.hypot(c.x - pc.x, c.y - pc.y);
                      return d < best.d ? { g, d } : best;
                    },
                    { g: allEntries[0], d: Infinity },
                  ).g;
                }
              }
              if (match.polygon.length >= 3) {
                poly = match.polygon;
                holePolys = match.holes.filter((h) => h.length >= 3);
                if (curves) curves = match.curves;
              }
            }
          }
        }
        if (!poly || poly.length < 3) return;
        const depth = resolveItemDepth(item);
        // Shift the 2D polygon so its centroid sits at the local
        // origin.  Without this the mesh pivot stays at the sketch
        // origin (often the world origin), making rotation and scaling
        // feel completely wrong.  Use the AREA centroid (density-invariant) so
        // this rendered-mesh pivot matches the OCC pivot in occOps.js
        // makeExtrude — otherwise an emboss face/cylinder picked off this mesh
        // lands in a different local frame than the OCC body it unions with (the
        // frames diverge for an asymmetric profile such as a bezier).
        const profileCentroid2D = polyAreaCentroid(poly);
        const centeredPoly = poly.map((p) => ({
          x: p.x - profileCentroid2D.x,
          y: p.y - profileCentroid2D.y,
        }));
        const centeredHoles = holePolys.map((h) =>
          h.map((p) => ({
            x: p.x - profileCentroid2D.x,
            y: p.y - profileCentroid2D.y,
          })),
        );
        // Normalize windings: outer CCW, holes CW.  Polygons traced
        // from sketch lines can come back from findClosedLoops in
        // either order (DFS traversal direction is arbitrary); without
        // normalization an inner hole drawn from lines ends up with
        // its side-wall normals inverted when fed to
        // THREE.ExtrudeGeometry.
        const outerCcw = withWinding(centeredPoly, /* wantCcw */ true);
        const holesCw = centeredHoles.map((h) =>
          withWinding(h, /* wantCcw */ false),
        );
        const shape = new THREE.Shape(
          outerCcw.map((p) => new THREE.Vector2(p.x, p.y)),
        );
        holesCw.forEach((hole) =>
          shape.holes.push(
            new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))),
          ),
        );
        // THREE.ExtrudeGeometry only takes a positive depth, so for a
        // negative-depth (backwards) extrude we extrude by the absolute
        // value and then translate the prism into the -Z half-space.
        const absDepth = Math.abs(depth);
        geometry = new THREE.ExtrudeGeometry(shape, {
          depth: absDepth,
          bevelEnabled: false,
        });
        // startOffset slides the prism's base along the profile normal (local
        // +Z) so the extrude can begin at a picked face / plane instead of the
        // sketch plane.  Combine it with the negative-depth back-shift.
        const startOffset = item.startOffset || 0;
        const baseZ = (depth < 0 ? -absDepth : 0) + startOffset;
        if (baseZ !== 0) geometry.translate(0, 0, baseZ);
        geometry.computeVertexNormals();
        if (curves)
          smoothCurvedWalls(
            geometry,
            [
              { polygon: poly, runs: curves.outer },
              ...holePolys.map((h, i) => ({
                polygon: h,
                runs: curves.holes?.[i],
              })),
            ],
            profileCentroid2D,
          );
        // The prism's base face sits at z=0 in the sketch's local
        // frame (positive depth extends to +depth, negative to
        // -|depth|).  Don't shift it to be midpoint-centred — the user
        // expects the base to sit ON the sketch plane.
        extrudeLocalOffset = new THREE.Vector3(
          profileCentroid2D.x,
          profileCentroid2D.y,
          0,
        );
        break;
      }
      default:
        return;
    }

    const materialProps = resolveItemMaterial(item, items, defaultMaterial);
    const color = materialProps.color ?? DEFAULT_MESH_COLOR;
    // A Plane object is a translucent double-sided reference surface, not solid.
    const material =
      item.type === "plane"
        ? new THREE.MeshBasicMaterial({
            color: 0x4488ff,
            transparent: true,
            opacity: 0.16,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        : createMaterial(item, color, materialProps);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = item.type !== "sketch" && item.type !== "plane";
    // Shadows only land on the ground plane (its ShadowMaterial receiver) —
    // objects cast but never receive, so they aren't self-/inter-shadowed.
    mesh.receiveShadow = false;
    mesh.userData.itemId = item.id;
    if (["sphere", "cylinder", "torus", "cone"].includes(item.type)) {
      mesh.userData.hullGeometry = geometry;
      mesh.userData.shaderMat = material;
    }

    const p = item.position;
    const rot = item.rotation;
    if (rot) mesh.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
    // Per-axis scale so the transform panel can stretch a single length; the
    // gizmo resize handle still writes all three equal (uniform) when dragged.
    const sc = item.scale;
    mesh.scale.set(sc?.x ?? 1, sc?.y ?? 1, sc?.z ?? 1);

    if (extrudeLocalOffset) {
      // Tag the mesh with the pre-rotation local offset so the drag
      // handler can subtract it when committing position to the store.
      // Without this, every drag commit would bake the offset into
      // item.position and the next rebuild would add it again, causing
      // the object to drift by one extra offset each move.
      mesh.userData.extrudeLocalOffset = {
        x: extrudeLocalOffset.x,
        y: extrudeLocalOffset.y,
        z: extrudeLocalOffset.z,
      };
      // Rotate the local centroid offset into world space and add it
      // to the stored sketch position so the solid appears where the
      // user drew it.
      extrudeLocalOffset.applyEuler(mesh.rotation);
      mesh.position.set(
        (p ? p.x : 0) + extrudeLocalOffset.x,
        (p ? p.y : 0) + extrudeLocalOffset.y,
        (p ? p.z : 0) + extrudeLocalOffset.z,
      );
    } else {
      mesh.position.set(p ? p.x : 0, p ? p.y : 2, p ? p.z : 0);
    }

    if (item.type === "sphere") {
      mesh.raycast = (raycaster, intersects) => {
        const worldCenter = new THREE.Vector3();
        mesh.getWorldPosition(worldCenter);
        const worldScale = new THREE.Vector3();
        mesh.getWorldScale(worldScale);
        const radius = primitiveDimensions(item).radius * worldScale.x;
        const sphere = new THREE.Sphere(worldCenter, radius);
        const target = new THREE.Vector3();
        if (!raycaster.ray.intersectSphere(sphere, target)) return;
        const dist = raycaster.ray.origin.distanceTo(target);
        if (dist < raycaster.near || dist > raycaster.far) return;
        intersects.push({
          distance: dist,
          point: target.clone(),
          face: { normal: target.clone().sub(worldCenter).normalize() },
          faceIndex: 0,
          object: mesh,
        });
      };
    } else if (item.type === "cylinder") {
      mesh.raycast = (raycaster, intersects) => {
        const wc = new THREE.Vector3();
        mesh.getWorldPosition(wc);
        const ws = new THREE.Vector3();
        mesh.getWorldScale(ws);
        const cdim = primitiveDimensions(item);
        const radius = cdim.radius * ws.x;
        const halfH = (cdim.height / 2) * ws.y;
        const axis = new THREE.Vector3(0, 1, 0)
          .applyQuaternion(mesh.quaternion)
          .normalize();
        const ray = raycaster.ray;
        const oc = new THREE.Vector3().subVectors(ray.origin, wc);
        const da = ray.direction.dot(axis);
        const oca = oc.dot(axis);
        const A = 1.0 - da * da;
        const B = 2.0 * (ray.direction.dot(oc) - da * oca);
        const C = oc.dot(oc) - oca * oca - radius * radius;
        let tHit = Infinity,
          nHit = null;
        if (Math.abs(A) > 1e-6) {
          const disc = B * B - 4 * A * C;
          if (disc >= 0) {
            const sq = Math.sqrt(disc);
            for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
              if (t > raycaster.near && t < tHit) {
                const p = ray.origin.clone().addScaledVector(ray.direction, t);
                const y = p.clone().sub(wc).dot(axis);
                if (Math.abs(y) <= halfH) {
                  tHit = t;
                  nHit = p
                    .clone()
                    .sub(wc)
                    .addScaledVector(axis, -y)
                    .normalize();
                }
              }
            }
          }
        }
        if (Math.abs(da) > 1e-6) {
          for (const sign of [1, -1]) {
            const t = (sign * halfH - oca) / da;
            if (t > raycaster.near && t < tHit) {
              const p = ray.origin.clone().addScaledVector(ray.direction, t);
              if (
                p
                  .clone()
                  .sub(wc)
                  .addScaledVector(axis, -sign * halfH)
                  .lengthSq() <=
                radius * radius
              ) {
                tHit = t;
                nHit = axis.clone().multiplyScalar(sign);
              }
            }
          }
        }
        if (tHit === Infinity || tHit > raycaster.far) return;
        intersects.push({
          distance: tHit,
          point: ray.origin.clone().addScaledVector(ray.direction, tHit),
          face: { normal: nHit || axis },
          faceIndex: 0,
          object: mesh,
        });
      };
    } else if (item.type === "torus") {
      mesh.raycast = (raycaster, intersects) => {
        const wc = new THREE.Vector3();
        mesh.getWorldPosition(wc);
        const ws = new THREE.Vector3();
        mesh.getWorldScale(ws);
        const tdim = primitiveDimensions(item);
        const outerR = (tdim.major + tdim.minor) * ws.x;
        const sphere = new THREE.Sphere(wc, outerR);
        const target = new THREE.Vector3();
        if (!raycaster.ray.intersectSphere(sphere, target)) return;
        const dist = raycaster.ray.origin.distanceTo(target);
        if (dist < raycaster.near || dist > raycaster.far) return;
        intersects.push({
          distance: dist,
          point: target.clone(),
          face: { normal: target.clone().sub(wc).normalize() },
          faceIndex: 0,
          object: mesh,
        });
      };
    } else if (item.type === "cone") {
      // Selection ray against the cone's bounding cylinder (radius = the larger
      // end) — close enough to pick it; the exact tapered surface is shader-drawn.
      mesh.raycast = (raycaster, intersects) => {
        const wc = new THREE.Vector3();
        mesh.getWorldPosition(wc);
        const ws = new THREE.Vector3();
        mesh.getWorldScale(ws);
        const cn = primitiveDimensions(item);
        const radius = Math.max(cn.radiusBottom, cn.radiusTop) * ws.x;
        const halfH = (cn.height / 2) * ws.y;
        const axis = new THREE.Vector3(0, 1, 0)
          .applyQuaternion(mesh.quaternion)
          .normalize();
        const ray = raycaster.ray;
        const oc = new THREE.Vector3().subVectors(ray.origin, wc);
        const da = ray.direction.dot(axis);
        const oca = oc.dot(axis);
        const A = 1.0 - da * da;
        const B = 2.0 * (ray.direction.dot(oc) - da * oca);
        const C = oc.dot(oc) - oca * oca - radius * radius;
        let tHit = Infinity,
          nHit = null;
        if (Math.abs(A) > 1e-6) {
          const disc = B * B - 4 * A * C;
          if (disc >= 0) {
            const sq = Math.sqrt(disc);
            for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
              if (t > raycaster.near && t < tHit) {
                const p = ray.origin.clone().addScaledVector(ray.direction, t);
                const y = p.clone().sub(wc).dot(axis);
                if (Math.abs(y) <= halfH) {
                  tHit = t;
                  nHit = p
                    .clone()
                    .sub(wc)
                    .addScaledVector(axis, -y)
                    .normalize();
                }
              }
            }
          }
        }
        for (const sign of Math.abs(da) > 1e-6 ? [1, -1] : []) {
          const t = (sign * halfH - oca) / da;
          if (t > raycaster.near && t < tHit) {
            const p = ray.origin.clone().addScaledVector(ray.direction, t);
            if (
              p
                .clone()
                .sub(wc)
                .addScaledVector(axis, -sign * halfH)
                .lengthSq() <=
              radius * radius
            ) {
              tHit = t;
              nHit = axis.clone().multiplyScalar(sign);
            }
          }
        }
        if (tHit === Infinity || tHit > raycaster.far) return;
        intersects.push({
          distance: tHit,
          point: ray.origin.clone().addScaledVector(ray.direction, tHit),
          face: { normal: nHit || axis },
          faceIndex: 0,
          object: mesh,
        });
      };
    } else if (item.type === "sketch") {
      mesh.add(buildSketchPlaneGrid());
    } else {
      mesh.add(
        new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({
            color: WIREFRAME_EDGE_COLOR,
            linewidth: 2,
          }),
        ),
      );
    }

    mesh.visible = item.visible !== false;
    // The reuse key for the next rebuild: any regen/commit replaces the
    // geometryData object, so reference equality is exactly "same geometry".
    if (item.type === "csg") mesh.userData.geometrySource = item.geometryData;
    scene.add(mesh);
    objectsRef.current[item.id] = mesh;
    originalMaterialsRef.current[item.id] = {
      color: new THREE.Color(color),
      metalness: materialProps.metalness ?? 0.3,
      roughness: materialProps.roughness ?? 0.5,
      opacity: materialProps.opacity ?? 1,
      clearcoat: materialProps.clearcoat ?? 0,
      clearcoatRoughness: materialProps.clearcoatRoughness ?? 0,
      emissive: new THREE.Color(NO_EMISSIVE),
    };
  });

  // Tear down whatever wasn't reused or rebuilt under the same id.
  Object.values(previousMeshes).forEach((mesh) => {
    if (reused.has(mesh)) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material.dispose();
    mesh.children.forEach((child) => {
      child.geometry && child.geometry.dispose();
      child.material && child.material.dispose();
    });
  });
}
