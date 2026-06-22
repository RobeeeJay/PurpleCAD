// Emboss tool picking: select sketch geometry (the extrude-select fills) and a
// target face.  Wired into the cameraControls mouse handlers when the emboss
// tool's geometry/faces pick is armed.  Phase 1 captures the clicked face's
// plane (centre-face projection); the connected-face grow lands with conform.

import * as THREE from "three";
import { useStore } from "../../store";
import { FACE_HOVER_COLOR } from "../theme.js";
import { polyArea } from "../sceneObjects/polygonUtil.js";

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
    if (hit) highlights.applyFaceHighlight(hit, FACE_HOVER_COLOR);
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

    // Face pick: capture the clicked face's plane in the body's local frame
    // (mirrors the hole tool's face capture).
    const hit = pickFaceHit(x, y);
    if (!hit) return true;
    const mesh = hit.object;
    const id = mesh.userData.itemId;
    const it = itemsRef.current.find((i) => i.id === id);
    const isPrim = ["sphere", "cylinder", "torus"].includes(it?.type);
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
    // A cylinder primitive's side is a wrap target for the conform projection —
    // its axis is local +Y (the radial click point gives the radius).  The flat
    // caps (normal ≈ ±Y) are not curved, so leave them as plain center faces.
    const onCurvedSide = it?.type === "cylinder" && Math.abs(localN.y) < 0.7;
    const faceSet = onCurvedSide ? { cylinder: { ax: 0, ay: 1, az: 0 } } : null;
    store.setEmbossFace(
      id,
      {
        nx: localN.x,
        ny: localN.y,
        nz: localN.z,
        cx: localP.x,
        cy: localP.y,
        cz: localP.z,
      },
      faceSet,
    );
    highlights.clearFaceHighlight();
    return true;
  };

  return { handleEmbossHover, handleEmbossClick, syncEmbossFills };
}
