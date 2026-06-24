// Emboss tool picking: select sketch geometry (the extrude-select fills) and a
// target face.  Wired into the cameraControls mouse handlers when the emboss
// tool's geometry/faces pick is armed.  Phase 1 captures the clicked face's
// plane (centre-face projection); the connected-face grow lands with conform.

import * as THREE from "three";
import { useStore } from "../../store";
import { FACE_HOVER_COLOR } from "../theme.js";
import { polyArea } from "../sceneObjects/polygonUtil.js";
import {
  growConnectedFaceSet,
  fitCylinderToFaceSet,
  fitSphereToFaceSet,
  extractDevelopableProfile,
  centerFaceOfSet,
  triData,
  validateFaceSetConnectivity,
} from "../embossFaceSet.js";

// Order-independent key for a triangle (3 rounded verts), so an accumulated
// face selection can be deduped / toggled.
const triKey = (p, i) => {
  const r = (x) => Math.round(x * 1000) / 1000;
  return [
    `${r(p[i])},${r(p[i + 1])},${r(p[i + 2])}`,
    `${r(p[i + 3])},${r(p[i + 4])},${r(p[i + 5])}`,
    `${r(p[i + 6])},${r(p[i + 7])},${r(p[i + 8])}`,
  ]
    .sort()
    .join("|");
};

// Add the clicked region's triangles to the accumulated set, or remove them if
// that region is already selected (re-clicking a face toggles it off).
const toggleRegion = (prev, region) => {
  const prevKeys = new Set();
  for (let i = 0; i + 8 < prev.length; i += 9) prevKeys.add(triKey(prev, i));
  const firstKey = region.length >= 9 ? triKey(region, 0) : null;
  const out = [];
  if (firstKey && prevKeys.has(firstKey)) {
    const remove = new Set();
    for (let i = 0; i + 8 < region.length; i += 9)
      remove.add(triKey(region, i));
    for (let i = 0; i + 8 < prev.length; i += 9)
      if (!remove.has(triKey(prev, i)))
        for (let k = 0; k < 9; k++) out.push(prev[i + k]);
  } else {
    for (let k = 0; k < prev.length; k++) out.push(prev[k]);
    for (let i = 0; i + 8 < region.length; i += 9)
      if (!prevKeys.has(triKey(region, i)))
        for (let k = 0; k < 9; k++) out.push(region[i + k]);
  }
  return out;
};

const SEL_COLOR = 0x44dd88; // selected sketch geometry fill
const HOVER_COLOR = 0x88ccff; // hovered fill

export function createEmbossInteraction({
  renderer,
  raycasterRef,
  cameraRef,
  mouseRef,
  objectsRef,
  itemsRef,
  extrudeSelectGroupRef,
  screenToSketchLocal,
  pointInPolygon2D,
  highlights,
}) {
  const setRay = (x, y) => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouseRef.current.x = ((x - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((y - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
  };

  // Point-in-polygon pick (matches extrude's findProfileAt): the smallest
  // enclosing region wins, which reliably selects thin glyphs over a raycast.
  const pickFill = (x, y) => {
    const fills = extrudeSelectGroupRef?.current?.children ?? [];
    let best = null,
      bestArea = Infinity;
    for (const fill of fills) {
      const profile = fill.userData.extrudeProfile;
      if (!profile) continue;
      const sketchMesh = objectsRef.current[profile.sketchId];
      if (!sketchMesh) continue;
      const lp = screenToSketchLocal(x, y, sketchMesh);
      if (!lp) continue;
      const inOuter = pointInPolygon2D(lp, profile.polygon2D);
      const inHole = (profile.holes || []).some((h) => pointInPolygon2D(lp, h));
      if (inOuter && !inHole) {
        const area = polyArea(profile.polygon2D);
        if (area < bestArea) {
          best = fill;
          bestArea = area;
        }
      }
    }
    return best;
  };

  const pickFaceHit = (x, y) => {
    setRay(x, y);
    const meshes = Object.values(objectsRef.current).filter((m) => {
      const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
      return it && it.type !== "sketch" && m.visible !== false;
    });
    return raycasterRef.current.intersectObjects(meshes, false)[0] || null;
  };

  // Turn a face hit into { id, mesh, face (centre plane, body-local), faceSet
  // (cylinder fit or null), setPositions (the connected set's tris for hover) }.
  const analyzeFace = (hit) => {
    const mesh = hit.object;
    const id = mesh.userData.itemId;
    const it = itemsRef.current.find((i) => i.id === id);
    const isPrim = ["sphere", "cylinder", "torus", "cone"].includes(it?.type);
    const worldN = hit.face
      ? hit.face.normal.clone()
      : new THREE.Vector3(0, 1, 0);
    if (!isPrim && hit.face)
      worldN.applyMatrix3(
        new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld),
      );
    worldN.normalize();
    const invQ = mesh.getWorldQuaternion(new THREE.Quaternion()).invert();
    const localN = worldN.clone().applyQuaternion(invQ).normalize();
    const localP = mesh.worldToLocal(hit.point.clone());
    const plane = {
      nx: localN.x,
      ny: localN.y,
      nz: localN.z,
      cx: localP.x,
      cy: localP.y,
      cz: localP.z,
    };

    // A cylinder primitive's curved side is a known wrap target (axis +Y).  Like
    // the sphere it's raymarched on a box hull, so project the box hit onto the
    // actual surface (known radius 1, makeCylinder) for the anchor + radius.
    if (it?.type === "cylinder" && Math.abs(localN.y) < 0.7) {
      const R = 1;
      const rad = Math.hypot(localP.x, localP.z) || 1;
      const sx = (localP.x / rad) * R,
        sz = (localP.z / rad) * R;
      return {
        id,
        mesh,
        face: { nx: sx / R, ny: 0, nz: sz / R, cx: sx, cy: localP.y, cz: sz },
        faceSet: {
          cylinder: { ax: 0, ay: 1, az: 0, cx: 0, cy: 0, cz: 0, radius: R },
        },
        setPositions: null,
      };
    }
    // A sphere primitive is raymarched on a 3×3×3 box HULL, so the raycast hits
    // the box — not the sphere.  Derive the surface anchor from the hit DIRECTION
    // and the known local radius (makeSphere(1.5)) instead of the box point /
    // axis-aligned box normal, or the relief wraps onto an oversized sphere and
    // floats off the body.
    if (it?.type === "sphere") {
      const R = 1.5;
      const dir = new THREE.Vector3(localP.x, localP.y, localP.z);
      if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
      dir.normalize();
      return {
        id,
        mesh,
        face: {
          nx: dir.x,
          ny: dir.y,
          nz: dir.z,
          cx: dir.x * R,
          cy: dir.y * R,
          cz: dir.z * R,
        },
        faceSet: { sphere: { cx: 0, cy: 0, cz: 0, radius: R } },
        setPositions: null,
      };
    }
    if (isPrim)
      return { id, mesh, face: plane, faceSet: null, setPositions: null };

    // CSG / cube: grow the connected face set across the curve-detection angle,
    // fit a cylinder to it, and project from its centre-most face.
    const maxAngle = useStore.getState().curveDetectionAngleDeg ?? 30;
    const grown = growConnectedFaceSet(
      mesh.geometry,
      hit.faceIndex,
      hit.face?.normal || localN,
      maxAngle,
    );
    if (!grown)
      return { id, mesh, face: plane, faceSet: null, setPositions: null };
    // The committed face set is (re)fit from the accumulated triangles in
    // handleEmbossClick — including the developable unroll — so here just hand back
    // the grown triangles for the hover highlight; the centre plane is enough.
    const center = centerFaceOfSet(grown.normals, grown.centroids) || plane;
    return {
      id,
      mesh,
      face: center,
      faceSet: null,
      setPositions: grown.positions,
    };
  };

  const cKey = (p) =>
    `${p.sketchId}:${p.textShapeIdx ?? "x"}:${
      p.profileCentroid
        ? p.profileCentroid.x.toFixed(3) + "," + p.profileCentroid.y.toFixed(3)
        : ""
    }`;
  const sameProfile = (a, b) => cKey(a) === cKey(b);
  const textKey = (p) =>
    p && p.type === "sketchLoop" && p.textShapeIdx != null
      ? `${p.sketchId}:${p.textShapeIdx}`
      : null;
  // Every fill belonging to the same text shape (one word), so picking a letter
  // grabs the whole word — like extrude.  A non-text loop is just itself.
  const textGroupFills = (fill) => {
    const k = textKey(fill.userData.extrudeProfile);
    if (!k) return [fill];
    const fills = extrudeSelectGroupRef?.current?.children ?? [];
    return fills.filter((f) => textKey(f.userData.extrudeProfile) === k);
  };

  // Two profiles share a plane when their normals are parallel and one's origin
  // lies on the other's plane.
  const coplanarWithFirst = (profile) => {
    const list = useStore.getState().embossTool?.profiles ?? [];
    if (!list.length) return true;
    const a = list[0];
    const na = new THREE.Vector3(
      a.normalWorld.x,
      a.normalWorld.y,
      a.normalWorld.z,
    ).normalize();
    const nb = new THREE.Vector3(
      profile.normalWorld.x,
      profile.normalWorld.y,
      profile.normalWorld.z,
    ).normalize();
    if (Math.abs(na.dot(nb)) < 0.999) return false;
    const d = new THREE.Vector3(
      profile.position.x - a.position.x,
      profile.position.y - a.position.y,
      profile.position.z - a.position.z,
    );
    return Math.abs(d.dot(na)) < 0.02; // ~0.2mm
  };

  // Paint the fills by current selection (plus an optional set of hovered fills).
  const syncEmbossFills = (hoverFills = []) => {
    const hoverSet = new Set(hoverFills);
    const fills = extrudeSelectGroupRef?.current?.children ?? [];
    const list = useStore.getState().embossTool?.profiles ?? [];
    for (const f of fills) {
      const p = f.userData.extrudeProfile;
      if (!p || !f.material) continue;
      if (list.some((q) => sameProfile(q, p))) {
        f.material.color.setHex(SEL_COLOR);
        f.material.opacity = 0.45;
      } else if (hoverSet.has(f)) {
        f.material.color.setHex(HOVER_COLOR);
        f.material.opacity = 0.3;
      } else {
        f.material.opacity = 0;
      }
    }
  };

  const handleEmbossHover = (x, y) => {
    const et = useStore.getState().embossTool;
    if (!et || !et.picking) return false;
    if (et.picking === "geometry") {
      const fill = pickFill(x, y);
      syncEmbossFills(fill ? textGroupFills(fill) : []);
      return true;
    }
    highlights.clearFaceHighlight();
    const hit = pickFaceHit(x, y);
    if (hit) {
      const a = analyzeFace(hit);
      if (a.setPositions)
        highlights.highlightFaceSet(a.mesh, a.setPositions, FACE_HOVER_COLOR);
      else highlights.applyFaceHighlight(hit, FACE_HOVER_COLOR);
    }
    return true;
  };

  const handleEmbossClick = (x, y, shift = false) => {
    const store = useStore.getState();
    const et = store.embossTool;
    if (!et || !et.picking) return false;

    if (et.picking === "geometry") {
      const fill = pickFill(x, y);
      if (!fill) return true;
      // Shift restricts the pick to this single glyph; otherwise a text letter
      // toggles the whole word, matching extrude.
      const group = shift ? [fill] : textGroupFills(fill);
      const groupProfiles = group.map((f) => f.userData.extrudeProfile);
      const list = et.profiles.slice();
      const anySel = groupProfiles.some((p) =>
        list.some((q) => sameProfile(q, p)),
      );
      let next;
      if (anySel) {
        next = list.filter(
          (q) => !groupProfiles.some((p) => sameProfile(q, p)),
        );
      } else {
        for (const p of groupProfiles) {
          if (!coplanarWithFirst(p)) {
            store.showNotification?.(
              "That sketch geometry is on a different plane to the first selection.",
            );
            return true;
          }
        }
        next = list.concat(groupProfiles.map((p) => ({ ...p })));
      }
      store.setEmbossProfiles(next);
      syncEmbossFills();
      return true;
    }

    // Face pick (all in the body's local frame).
    const hit = pickFaceHit(x, y);
    if (!hit) return true;
    const a = analyzeFace(hit);

    // A primitive's curved face is parametric (no triangle set) — one click is
    // the whole face, always valid.
    if (!a.setPositions) {
      store.setEmbossFaceSelection({
        itemId: a.id,
        face: a.face,
        faceSet: a.faceSet,
        faceTris: null,
        valid: true,
        keepPicking: false,
      });
      highlights.clearFaceHighlight();
      highlights.clearSelectedFaces?.();
      return true;
    }

    // Mesh faces: accumulate the clicked region (toggle), re-fit, and validate
    // that the combined set is connected within 45° — that gates Confirm.
    const startedNewBody = et.itemId != null && et.itemId !== a.id;
    const prev = !startedNewBody && et.faceTris ? et.faceTris : [];
    const combined = toggleRegion(prev, a.setPositions);
    if (combined.length < 9) {
      store.setEmbossFaceSelection({
        itemId: null,
        face: null,
        faceSet: null,
        faceTris: null,
        valid: false,
        keepPicking: true,
      });
      highlights.clearSelectedFaces?.();
    } else {
      const { normals, centroids } = triData(combined);
      // Same preference order as analyzeFace: unroll the ACTUAL extruded curve
      // (developable) so a non-circular wall — two joined beziers, an S-curve — is
      // followed exactly, instead of a single mismatched cylinder the relief sinks
      // through.  This is the committed face set, so it MUST do the dev fit too.
      const dev = extractDevelopableProfile(combined, normals);
      const cyl = dev ? null : fitCylinderToFaceSet(normals, centroids);
      const sph = dev || cyl ? null : fitSphereToFaceSet(normals, combined);
      const center = centerFaceOfSet(normals, centroids) || a.face;
      const valid = validateFaceSetConnectivity(combined, 45);
      store.setEmbossFaceSelection({
        itemId: a.id,
        face: center,
        faceSet: dev
          ? { developable: dev }
          : cyl
            ? { cylinder: cyl }
            : sph
              ? { sphere: sph }
              : null,
        faceTris: combined,
        valid,
        keepPicking: true,
      });
      if (!valid)
        store.showNotification?.(
          "Selected faces aren't all connected within 45° — Confirm stays disabled.",
        );
      highlights.highlightSelectedFaces?.(a.mesh, combined, FACE_HOVER_COLOR);
    }
    highlights.clearFaceHighlight();
    return true;
  };

  return { handleEmbossHover, handleEmbossClick, syncEmbossFills };
}
