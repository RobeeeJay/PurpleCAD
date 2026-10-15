// Emboss tool picking: select sketch geometry (the extrude-select fills) and a
// target face.  Wired into the cameraControls mouse handlers when the emboss
// tool's geometry/faces pick is armed.  Phase 1 captures the clicked face's
// plane (centre-face projection); the connected-face grow lands with conform.

import * as THREE from "three";
import { useStore } from "../../store";
import { FACE_HOVER_COLOR } from "../theme.js";
import { polyArea } from "../sceneObjects/polygonUtil.js";

// Count DISTINCT planar faces in a triangle soup: group triangles by their
// supporting plane (rounded normal + signed offset) and count the groups.  A
// flat face's triangles share a plane (→ 1); adjacent faces have different
// normals (→ separate); a curved wall's tessellation segments each count.
const distinctFaceCount = (p) => {
  const set = new Set();
  const r = (x) => Math.round(x * 100) / 100;
  for (let i = 0; i + 8 < p.length; i += 9) {
    const ax = p[i],
      ay = p[i + 1],
      az = p[i + 2];
    const bx = p[i + 3],
      by = p[i + 4],
      bz = p[i + 5];
    const cx = p[i + 6],
      cy = p[i + 7],
      cz = p[i + 8];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const d = nx * ax + ny * ay + nz * az;
    set.add(`${r(nx)},${r(ny)},${r(nz)},${r(d)}`);
  }
  return set.size;
};
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

  // A primitive's picked face as a LOCAL-frame triangle soup, so the shared
  // highlight helpers (hover + selected) give the same visual feedback a mesh
  // face pick gets.  Built from the analytic surface, NOT the raymarch hull.
  const primitiveFaceSoup = (it, faceSet, face) => {
    const d = it.dimensions || {};
    let geo = null;
    if (faceSet?.cylinder) {
      const { radius } = faceSet.cylinder;
      geo = new THREE.CylinderGeometry(
        radius,
        radius,
        d.height ?? 2,
        48,
        1,
        true,
      );
    } else if (faceSet?.sphere) {
      geo = new THREE.SphereGeometry(faceSet.sphere.radius, 48, 24);
    } else if (faceSet?.cone) {
      const { rb, rt, h } = faceSet.cone;
      geo = new THREE.CylinderGeometry(Math.max(rt, 1e-4), rb, h, 48, 1, true);
    } else if (faceSet?.torus) {
      const { R, r } = faceSet.torus;
      geo = new THREE.TorusGeometry(R, r, 24, 48);
      geo.rotateX(Math.PI / 2); // THREE's torus rings around Z; ours around Y
    } else if (faceSet?.plane && face) {
      // Cap disc at the picked plane's height, radius from the primitive.
      const radius =
        it.type === "cone"
          ? face.ny > 0
            ? (d.radiusTop ?? 0)
            : (d.radiusBottom ?? 1)
          : (d.radius ?? 1);
      if (radius > 1e-4) {
        geo = new THREE.CircleGeometry(radius, 48);
        geo.rotateX(face.ny > 0 ? -Math.PI / 2 : Math.PI / 2);
        geo.translate(0, face.cy, 0);
      }
    }
    if (!geo) return null;
    const soup = geo.toNonIndexed().attributes.position.array;
    geo.dispose();
    return Array.from(soup);
  };

  // Turn a face hit into { id, mesh, face (centre plane, body-local), faceSet
  // (cylinder fit or null), setPositions (the connected set's tris for hover),
  // surfaceSoup (primitive-only: analytic tris for highlight display) }.
  const analyzeFace = (hit) => {
    const a = analyzeFaceInner(hit);
    if (a && !a.setPositions && a.faceSet) {
      const it = itemsRef.current.find((i) => i.id === a.id);
      a.surfaceSoup = primitiveFaceSoup(it, a.faceSet, a.face);
    }
    return a;
  };
  const analyzeFaceInner = (hit) => {
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
    // actual surface (its OCC local radius/height) for the anchor + radius.
    if (it?.type === "cylinder" && Math.abs(localN.y) < 0.7) {
      const R = it.dimensions?.radius ?? 1;
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
    // Cylinder cap: a flat analytic face — no triangle set to grow (the hull
    // mesh is a box, not the surface).  The plane rides in the faceSet so the
    // texture region test can bound itself without faceTris.
    if (it?.type === "cylinder") {
      const h = it.dimensions?.height ?? 2;
      const cy = localN.y > 0 ? h / 2 : -h / 2;
      const face = {
        nx: 0,
        ny: Math.sign(localN.y),
        nz: 0,
        cx: localP.x,
        cy,
        cz: localP.z,
      };
      return { id, mesh, face, faceSet: { plane: face }, setPositions: null };
    }
    // A sphere primitive is raymarched on a 3×3×3 box HULL, so the raycast hits
    // the box — not the sphere.  Derive the surface anchor from the hit DIRECTION
    // and the known local radius instead of the box point / axis-aligned box
    // normal, or the relief wraps onto an oversized sphere and floats off the
    // body.
    if (it?.type === "sphere") {
      const R = it.dimensions?.radius ?? 1.5;
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
    // Cone (axis +Y, centred): side picks carry the analytic cone; near-flat
    // hits at the top/bottom rings are the caps.
    if (it?.type === "cone") {
      const rb = it.dimensions?.radiusBottom ?? 1;
      const rt = it.dimensions?.radiusTop ?? 0;
      const h = it.dimensions?.height ?? 2;
      const capBottom = localP.y < -h / 2 + 1e-3 && Math.abs(localN.y) > 0.7;
      const capTop =
        rt > 1e-6 && localP.y > h / 2 - 1e-3 && Math.abs(localN.y) > 0.7;
      if (capBottom || capTop) {
        const cy = capTop ? h / 2 : -h / 2;
        const face = {
          nx: 0,
          ny: capTop ? 1 : -1,
          nz: 0,
          cx: localP.x,
          cy,
          cz: localP.z,
        };
        return { id, mesh, face, faceSet: { plane: face }, setPositions: null };
      }
      // Project the hull hit onto the cone surface at its height.
      const y = Math.max(-h / 2, Math.min(h / 2, localP.y));
      const rAt = rb + ((rt - rb) * (y + h / 2)) / h;
      const rad = Math.hypot(localP.x, localP.z) || 1;
      const sx = (localP.x / rad) * rAt,
        sz = (localP.z / rad) * rAt;
      const slope = (rb - rt) / h;
      const nl = Math.hypot(1, slope) || 1;
      return {
        id,
        mesh,
        face: {
          nx: ((localP.x / rad) * 1) / nl,
          ny: slope / nl,
          nz: ((localP.z / rad) * 1) / nl,
          cx: sx,
          cy: y,
          cz: sz,
        },
        faceSet: { cone: { rb, rt, h } },
        setPositions: null,
      };
    }
    // Torus (axis +Y, centred): the whole surface is one face.  Anchor =
    // nearest point on the tube; normal = out of the tube.
    if (it?.type === "torus") {
      const R = it.dimensions?.major ?? 1;
      const r = it.dimensions?.minor ?? 0.4;
      const rad = Math.hypot(localP.x, localP.z) || 1;
      const ring = { x: (localP.x / rad) * R, y: 0, z: (localP.z / rad) * R };
      const dx = localP.x - ring.x,
        dy = localP.y - ring.y,
        dz = localP.z - ring.z;
      const dl = Math.hypot(dx, dy, dz) || 1;
      return {
        id,
        mesh,
        face: {
          nx: dx / dl,
          ny: dy / dl,
          nz: dz / dl,
          cx: ring.x + (dx / dl) * r,
          cy: ring.y + (dy / dl) * r,
          cz: ring.z + (dz / dl) * r,
        },
        faceSet: { torus: { R, r } },
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
      const soup = a.setPositions || a.surfaceSoup;
      if (soup) highlights.highlightFaceSet(a.mesh, soup, FACE_HOVER_COLOR);
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
      if (a.surfaceSoup)
        highlights.highlightSelectedFaces?.(
          a.mesh,
          a.surfaceSoup,
          FACE_HOVER_COLOR,
        );
      else highlights.clearSelectedFaces?.();
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
      // Count distinct planar faces selected (for the Faces button).
      const faceCount = distinctFaceCount(combined);
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
        faceCount,
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

  // ── Texture tool face picking ─────────────────────────────────────────────
  // Same analyze/toggle/fit pipeline as the emboss face pick, writing the
  // textureTool's selection instead (no geometry-pick phase — the texture's
  // "geometry" is a PNG chosen in the dialog).
  const handleTextureHover = (x, y) => {
    const tt = useStore.getState().textureTool;
    if (!tt || tt.picking !== "faces") return false;
    highlights.clearFaceHighlight();
    const hit = pickFaceHit(x, y);
    if (hit) {
      const a = analyzeFace(hit);
      const soup = a.setPositions || a.surfaceSoup;
      if (soup) highlights.highlightFaceSet(a.mesh, soup, FACE_HOVER_COLOR);
      else highlights.applyFaceHighlight(hit, FACE_HOVER_COLOR);
    }
    return true;
  };

  const handleTextureClick = (x, y) => {
    const store = useStore.getState();
    const tt = store.textureTool;
    if (!tt || tt.picking !== "faces") return false;
    const hit = pickFaceHit(x, y);
    if (!hit) return true;
    const a = analyzeFace(hit);

    // A primitive's curved face is parametric — one click is the whole face.
    if (!a.setPositions) {
      store.setTextureFaceSelection({
        itemId: a.id,
        face: a.face,
        faceSet: a.faceSet,
        faceTris: null,
        valid: true,
        keepPicking: false,
      });
      highlights.clearFaceHighlight();
      // Same feedback a mesh pick gets: the analytic face lights up.
      if (a.surfaceSoup)
        highlights.highlightSelectedFaces?.(
          a.mesh,
          a.surfaceSoup,
          FACE_HOVER_COLOR,
        );
      else highlights.clearSelectedFaces?.();
      return true;
    }

    const startedNewBody = tt.itemId != null && tt.itemId !== a.id;
    const prev = !startedNewBody && tt.faceTris ? tt.faceTris : [];
    const combined = toggleRegion(prev, a.setPositions);
    if (combined.length < 9) {
      store.setTextureFaceSelection({
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
      const dev = extractDevelopableProfile(combined, normals);
      const cyl = dev ? null : fitCylinderToFaceSet(normals, centroids);
      const sph = dev || cyl ? null : fitSphereToFaceSet(normals, combined);
      const center = centerFaceOfSet(normals, centroids) || a.face;
      const valid = validateFaceSetConnectivity(combined, 45);
      const faceCount = distinctFaceCount(combined);
      store.setTextureFaceSelection({
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
        faceCount,
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

  // ── Stress tool face picking ──────────────────────────────────────────────
  // The same hit test and toggle, but none of the fitting: a stress pick only
  // ever needs the triangle soup.  Nor the 45-degree connectivity gate --
  // holding two opposite lugs, or loading faces that meet at a corner, is a
  // perfectly ordinary load case, where for an emboss it would be nonsense.
  // Stress and the optimiser pick faces identically -- held here, loaded
  // there -- so one handler serves whichever of the two is open.
  const activePickTool = () => {
    const s = useStore.getState();
    if (s.stressTool)
      return { tool: s.stressTool, set: s.setStressFaceSelection };
    if (s.optimiseTool)
      return { tool: s.optimiseTool, set: s.setOptimiseFaceSelection };
    return null;
  };

  const handleStressHover = (x, y) => {
    const st = activePickTool()?.tool;
    if (!st || st.phase === "params") return false;
    highlights.clearFaceHighlight();
    const hit = pickFaceHit(x, y);
    if (hit) {
      const a = analyzeFace(hit);
      const soup = a.setPositions || a.surfaceSoup;
      if (soup) highlights.highlightFaceSet(a.mesh, soup, FACE_HOVER_COLOR);
      else highlights.applyFaceHighlight(hit, FACE_HOVER_COLOR);
    }
    return true;
  };

  const handleStressClick = (x, y) => {
    const active = activePickTool();
    const st = active?.tool;
    if (!st || st.phase === "params") return false;
    const hit = pickFaceHit(x, y);
    if (!hit) return true;
    const a = analyzeFace(hit);
    const soup = a.setPositions || a.surfaceSoup;
    if (!soup) return true;
    // A body is analysed on its own: picking a face of a different one starts
    // the load case over rather than silently mixing two sets of coordinates.
    const startedNewBody = st.itemId != null && st.itemId !== a.id;
    const key = st.phase === "loads" ? "loadFaces" : "fixtures";
    const prev = startedNewBody ? [] : (st[key] ?? []);
    const combined = toggleRegion(prev, soup);
    active.set({ itemId: a.id, faceTris: combined });
    if (combined.length)
      highlights.highlightSelectedFaces?.(a.mesh, combined, FACE_HOVER_COLOR);
    else highlights.clearSelectedFaces?.();
    highlights.clearFaceHighlight();
    return true;
  };

  return {
    handleEmbossHover,
    handleEmbossClick,
    syncEmbossFills,
    handleTextureHover,
    handleTextureClick,
    handleStressHover,
    handleStressClick,
  };
}
