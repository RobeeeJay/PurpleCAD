// In-viewport preview scaffolding for the 3D tools: the plane, 3D pattern,
// boolean dim, plane-pick markers, circular-pattern axis, split solids, the
// project tool and the live Text preview.  Each attaches its show/clear pair
// onto the shared `controls` handle (cameraControlsRef.current) exactly as it
// did inline, which is how the React layer reaches them -- there are no
// textual references to these locals elsewhere in cameraControls.js.

import * as THREE from "three";
import { useStore } from "../../store";
import { MM_PER_UNIT } from "../sceneObjects.js";
import { textShapeContours, makeTextShape } from "../sketchText.js";
import {
  frameFromPoints,
  frameFromPointNormal,
  frameFromFaceHit,
  planeCrossesPoints,
} from "../planeFrame.js";
import { createProjectTool } from "./projectTool.js";

export function createToolPreviews({
  controls,
  extrude,
  highlights,
  scene,
  renderer,
  cameraRef,
  cameraAnimRef,
  cameraControlsRef,
  targetRef,
  itemsRef,
  objectsRef,
  selectedIdRef,
  setRotationState,
}) {
  // Live preview of a Plane object while the creation dialog adjusts its
  // rotation/offset.  Pass null to clear.
  let planePreviewMesh = null;
  controls.previewPlane = (frame) => {
    if (!frame) {
      if (planePreviewMesh) {
        scene.remove(planePreviewMesh);
        planePreviewMesh.geometry.dispose();
        planePreviewMesh.material.dispose();
        planePreviewMesh = null;
      }
      return;
    }
    if (!planePreviewMesh) {
      planePreviewMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 6),
        new THREE.MeshBasicMaterial({
          color: 0x4488ff,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      planePreviewMesh.renderOrder = 999;
      scene.add(planePreviewMesh);
    }
    planePreviewMesh.position.set(
      frame.position.x,
      frame.position.y,
      frame.position.z,
    );
    planePreviewMesh.rotation.set(
      frame.rotation.x || 0,
      frame.rotation.y || 0,
      frame.rotation.z || 0,
    );
  };
  controls.clearPlanePreview = () => controls.previewPlane(null);

  // Live preview of a 3D pattern (circular/rectangular), a mirror or a boolean
  // while its dialog adjusts parameters / picks.  Accepts a single result or an
  // array of results (Mirror can mirror several objects at once).
  //
  // Each preview is computed asynchronously -- a boolean with an imported mesh
  // takes seconds -- so a dialog takes a token when it starts one
  // (beginToolPreview) and hands it back with the result.  Clearing, which
  // every dialog does as it closes, invalidates the outstanding tokens, and a
  // newer run supersedes an older one.  Without this, a result landing after
  // its dialog had closed was drawn with nothing left to clear it: it stayed
  // in the scene, in every project, until the next preview happened to
  // replace it (the base STL "appearing in every project").
  let patternPreviewGroup = null;
  let previewToken = 0;
  controls.beginToolPreview = () => ++previewToken;
  const current = (token) => token == null || token === previewToken;
  // Whether a tool preview is in the scene -- for tests and diagnostics.
  controls.previewShown = () => patternPreviewGroup != null;
  controls.previewPattern3d = (result, token) => {
    if (result && !current(token)) return;
    drawPreviewGroup(result);
  };
  const drawPreviewGroup = (result) => {
    if (patternPreviewGroup) {
      patternPreviewGroup.children.forEach((m) => {
        m.geometry.dispose();
        m.material.dispose();
      });
      scene.remove(patternPreviewGroup);
      patternPreviewGroup = null;
    }
    if (!result) return;
    const list = (Array.isArray(result) ? result : [result]).filter(
      (r) => r?.geometryData,
    );
    if (list.length === 0) return;
    const group = new THREE.Group();
    for (const r of list) {
      const { positions, indices } = r.geometryData;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(positions), 3),
      );
      if (indices)
        geom.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
      geom.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({
          color: 0x6c3fd4,
          roughness: 0.55,
          metalness: 0,
          transparent: true,
          opacity: 0.65,
        }),
      );
      const p = r.position || { x: 0, y: 0, z: 0 };
      mesh.position.set(p.x, p.y, p.z);
      mesh.renderOrder = 998;
      group.add(mesh);
    }
    scene.add(group);
    patternPreviewGroup = group;
  };
  controls.clearPattern3dPreview = () => {
    previewToken++;
    drawPreviewGroup(null);
  };

  // Boolean/Cut preview: fade the input bodies to 15% opacity so the translucent
  // result ghost reads clearly through them, then show the ghost.  Restored by
  // clearBooleanPreview.  Handles both the primitive shader materials (uOpacity
  // uniform) and the standard mesh materials (material.opacity).
  let booleanDimmed = [];
  const BOOLEAN_DIM_OPACITY = 0.15;
  controls.previewBoolean = (result, inputIds, token) => {
    if (!current(token)) return;
    restoreDimmed();
    drawPreviewGroup(null);
    for (const id of inputIds || []) {
      const mesh = objectsRef.current[id];
      const m = mesh?.material;
      if (!m) continue;
      const u = m.uniforms?.uOpacity;
      booleanDimmed.push({
        m,
        u,
        prevTransparent: m.transparent,
        prevOpacity: m.opacity,
        prevDepthWrite: m.depthWrite,
        prevU: u ? u.value : null,
      });
      m.transparent = true;
      m.depthWrite = false;
      if (u) u.value = BOOLEAN_DIM_OPACITY;
      else m.opacity = BOOLEAN_DIM_OPACITY;
      m.needsUpdate = true;
    }
    drawPreviewGroup(result);
  };
  const restoreDimmed = () => {
    for (const d of booleanDimmed) {
      d.m.transparent = d.prevTransparent;
      d.m.opacity = d.prevOpacity;
      d.m.depthWrite = d.prevDepthWrite;
      if (d.u && d.prevU != null) d.u.value = d.prevU;
      d.m.needsUpdate = true;
    }
    booleanDimmed = [];
  };
  controls.clearBooleanPreview = () => {
    restoreDimmed();
    controls.clearPattern3dPreview();
  };

  // Pick 3 points (snapping to object vertices) to define a new Plane.  Markers
  // mark each pick; the 3rd derives a frame and opens the creation dialog.
  let planePickPoints = [];
  let planePickMarkers = [];
  controls.clearPlanePick = () => {
    planePickMarkers.forEach((m) => {
      scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    });
    planePickMarkers = [];
    planePickPoints = [];
  };
  controls.planePickClick = (screenX, screenY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const meshes = Object.values(objectsRef.current).filter(
      (m) => m.visible !== false,
    );
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) return;
    // Snap to the nearest vertex of the hit triangle (real geometry only);
    // primitives raycast against a hull/sphere, so fall back to the hit point.
    let p = hit.point.clone();
    const posAttr = hit.face && hit.object.geometry?.getAttribute("position");
    if (posAttr) {
      let best = p,
        bd = Infinity;
      [hit.face.a, hit.face.b, hit.face.c].forEach((idx) => {
        const v = new THREE.Vector3()
          .fromBufferAttribute(posAttr, idx)
          .applyMatrix4(hit.object.matrixWorld);
        const d = v.distanceTo(hit.point);
        if (d < bd) {
          bd = d;
          best = v;
        }
      });
      p = best;
    }
    planePickPoints.push({ x: p.x, y: p.y, z: p.z });
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x44aaff, depthTest: false }),
    );
    marker.position.copy(p);
    marker.renderOrder = 1011;
    scene.add(marker);
    planePickMarkers.push(marker);

    if (planePickPoints.length >= 3) {
      const base = frameFromPoints(
        planePickPoints[0],
        planePickPoints[1],
        planePickPoints[2],
      );
      controls.clearPlanePick();
      useStore.getState().setPlanePickActive(false);
      if (base) useStore.getState().startPlaneTool(base);
      else
        useStore
          .getState()
          .showNotification?.("Pick three non-collinear points.");
    }
  };

  // Pick an object face: its world plane (click point + face normal) seeds a
  // new Plane and reopens the creation dialog.
  controls.planeFacePickClick = (screenX, screenY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const meshes = Object.values(objectsRef.current).filter(
      (m) => m.visible !== false,
    );
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit || !hit.face) {
      useStore.getState().showNotification?.("Click a face to define a plane.");
      return;
    }
    const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const worldN = hit.face.normal.clone().applyMatrix3(nm).normalize();
    const base = frameFromPointNormal(hit.point, worldN);
    useStore.getState().setPlanePickActive(false);
    if (base) useStore.getState().startPlaneTool(base);
  };

  // Pick the circular pattern's rotation axis: the nearest sketch line or solid
  // face edge under the cursor.  Stores it as { origin, dir } (world) on the
  // pattern tool, highlights it, and ends the pick.
  let circularAxisHL = null;
  controls.clearCircularAxisHighlight = () => {
    if (!circularAxisHL) return;
    scene.remove(circularAxisHL);
    circularAxisHL.geometry.dispose();
    circularAxisHL.material.dispose();
    circularAxisHL = null;
  };
  controls.pickCircularAxis = (screenX, screenY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const toScreen = (w) => {
      const ndc = w.clone().project(cameraRef.current);
      return {
        x: ((ndc.x + 1) / 2) * rect.width + rect.left,
        y: ((-ndc.y + 1) / 2) * rect.height + rect.top,
      };
    };
    const segDist = (px, py, a, b) => {
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1e-9;
      let t = ((px - a.x) * dx + (py - a.y) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
    };
    let best = null;
    let bestD = 14;
    const consider = (wa, wb) => {
      const d = segDist(screenX, screenY, toScreen(wa), toScreen(wb));
      if (d < bestD) {
        bestD = d;
        best = { a: wa.clone(), b: wb.clone() };
      }
    };
    // Sketch lines (a clean straight axis the user can draw on purpose).
    itemsRef.current.forEach((sk) => {
      if (sk.type !== "sketch") return;
      const mesh = objectsRef.current[sk.id];
      if (!mesh || mesh.visible === false) return;
      (sk.shapes || []).forEach((s) => {
        if (s.type !== "line") return;
        const wa = new THREE.Vector3(s.x1, s.y1, 0)
          .applyQuaternion(mesh.quaternion)
          .add(mesh.position);
        const wb = new THREE.Vector3(s.x2, s.y2, 0)
          .applyQuaternion(mesh.quaternion)
          .add(mesh.position);
        consider(wa, wb);
      });
    });
    // Face edges: the edges of the triangle hit under the cursor (a model edge
    // of a box/extrude face is the nearest of the three to the click).
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const meshes = Object.values(objectsRef.current).filter(
      (m) => m.visible !== false,
    );
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit && hit.face) {
      const posAttr = hit.object.geometry.getAttribute("position");
      const v = (i) =>
        new THREE.Vector3()
          .fromBufferAttribute(posAttr, i)
          .applyMatrix4(hit.object.matrixWorld);
      const va = v(hit.face.a),
        vb = v(hit.face.b),
        vc = v(hit.face.c);
      consider(va, vb);
      consider(vb, vc);
      consider(vc, va);
    }
    if (!best) {
      useStore
        .getState()
        .showNotification?.("Click a sketch line or a face edge for the axis.");
      return;
    }
    const dir = best.b.clone().sub(best.a).normalize();
    controls.clearCircularAxisHighlight();
    const geo = new THREE.BufferGeometry().setFromPoints([best.a, best.b]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0x44aaff, depthTest: false }),
    );
    line.renderOrder = 1011;
    scene.add(line);
    circularAxisHL = line;
    useStore.getState().setCircularAxisPick(false);
    useStore.getState().updatePattern3d({
      axis: {
        origin: { x: best.a.x, y: best.a.y, z: best.a.z },
        dir: { x: dir.x, y: dir.y, z: dir.z },
      },
    });
  };

  // Split tool picks (plain clicks): first an object to split, then a cut — a
  // Plane/sketch item, or any solid face (its plane).  Shows a translucent
  // preview of the cut plane.  Mirrors the plane face-pick raycast.
  const splitRaycast = (screenX, screenY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const meshes = Object.values(objectsRef.current).filter(
      (m) => m.visible !== false,
    );
    return ray.intersectObjects(meshes, false)[0] || null;
  };
  const SPLIT_SOLIDS = [
    "cube",
    "sphere",
    "cylinder",
    "torus",
    "extrude",
    "csg",
  ];
  controls.pickSplitObject = (screenX, screenY) => {
    const hit = splitRaycast(screenX, screenY);
    const item = hit
      ? itemsRef.current.find((i) => i.id === hit.object.userData.itemId)
      : null;
    if (!item || !SPLIT_SOLIDS.includes(item.type)) {
      useStore.getState().showNotification?.("Click an object to split.");
      return;
    }
    useStore
      .getState()
      .updateSplit3d({ objectId: item.id, objectName: item.name });
    // Guide the user straight on to picking the cut.
    useStore.getState().setSplitPick("cut");
  };
  controls.pickSplitCut = (screenX, screenY) => {
    const hit = splitRaycast(screenX, screenY);
    const item = hit
      ? itemsRef.current.find((i) => i.id === hit.object.userData.itemId)
      : null;
    if (!item) {
      useStore
        .getState()
        .showNotification?.("Click a plane, a sketch, or a face to cut along.");
      return;
    }
    let frame, label;
    if (item.type === "plane" || item.type === "sketch") {
      frame = { position: item.position, rotation: item.rotation };
      label = item.name;
    } else if (hit.face) {
      const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      const worldN = hit.face.normal.clone().applyMatrix3(nm).normalize();
      // On the clicked triangle exactly, not on the float hit point.
      const pos = hit.object.geometry.attributes.position;
      const corner = (i) =>
        new THREE.Vector3()
          .fromBufferAttribute(pos, i)
          .applyMatrix4(hit.object.matrixWorld);
      frame =
        frameFromFaceHit(
          hit.point,
          corner(hit.face.a),
          corner(hit.face.b),
          corner(hit.face.c),
          worldN,
        ) ?? frameFromPointNormal(hit.point, worldN);
      label = `face of ${item.name}`;
    }
    if (!frame) return;
    // The cut has to pass THROUGH the body.  A face of the body itself -- the
    // natural first thing to click -- lies on its surface and cuts nothing; the
    // split used to go ahead anyway and hand back a renamed copy.
    const store = useStore.getState();
    const target = objectsRef.current[store.splitTool?.objectId];
    if (target && !planeCrossesPoints(frame, worldPositions(target))) {
      store.setToolError(
        `That ${item.type === "plane" || item.type === "sketch" ? "plane" : "face"} doesn't pass through ${store.splitTool.objectName} — pick a face or plane that cuts across it.`,
      );
      return;
    }
    store.setToolError(null);
    store.updateSplit3d({ cutFrame: frame, cutLabel: label });
    store.setSplitPick(null);
    controls.previewPlane(frame);
  };

  // A mesh's vertices in world space, flattened.  A primitive is drawn on a box
  // hull, so for one this is the hull's corners -- a superset of the body, which
  // can let through a plane that clips only the hull; the split itself then
  // comes back one-sided and the dialog refuses it there.
  const worldPositions = (mesh) => {
    mesh.updateMatrixWorld(true);
    const src = mesh.geometry.attributes.position;
    const out = new Float32Array(src.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(mesh.matrixWorld);
      out[i * 3] = v.x;
      out[i * 3 + 1] = v.y;
      out[i * 3 + 2] = v.z;
    }
    return out;
  };

  // The active sketch + its mesh, or null.  Shared by the Project tool and the
  // Text-tool preview (both draw onto the active sketch plane).
  const activeSketchForProject = () => {
    const sketch = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current && i.type === "sketch",
    );
    const sketchMesh = sketch ? objectsRef.current[sketch.id] : null;
    return sketch && sketchMesh ? { sketch, sketchMesh } : null;
  };

  // ── Project tool ── (edge/marquee projection; see projectTool.js)
  createProjectTool({
    scene,
    renderer,
    cameraRef,
    objectsRef,
    itemsRef,
    controls,
    activeSketchForProject,
  });

  // Live Text-tool preview: draw the draft text's glyph outlines on the active
  // sketch plane while the Text dialog is open (driven by its inputs).
  let textPreviewGroup = null;
  controls.clearTextPreview = () => {
    if (!textPreviewGroup) return;
    scene.remove(textPreviewGroup);
    textPreviewGroup.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    textPreviewGroup = null;
  };
  controls.updateTextPreview = (draft) => {
    controls.clearTextPreview();
    const ctx = activeSketchForProject();
    if (!ctx || !draft) return;
    const shape = makeTextShape({
      text: draft.text,
      height: (draft.heightMm || 0) / MM_PER_UNIT,
      font: draft.font,
      x: draft.x,
      y: draft.y,
    });
    const { sketchMesh } = ctx;
    const toW = (lx, ly) =>
      new THREE.Vector3(lx, ly, 0.004)
        .applyQuaternion(sketchMesh.quaternion)
        .add(sketchMesh.position);
    const group = new THREE.Group();
    for (const contour of textShapeContours(shape)) {
      if (contour.length < 2) continue;
      const pts = [...contour, contour[0]].map((p) => toW(p.x, p.y));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: 0x6c3fd4,
          depthTest: false,
          transparent: true,
          opacity: 0.9,
        }),
      );
      line.renderOrder = 1011;
      line.frustumCulled = false;
      group.add(line);
    }
    scene.add(group);
    textPreviewGroup = group;
  };

  // Snapshot / restore the camera view (used by the Objects-list Solo button so
  // toggling solo off returns to where the user was).
  controls.captureView = () => {
    if (!cameraRef.current || !cameraControlsRef.current) return null;
    return {
      positionX: cameraRef.current.position.x,
      positionY: cameraRef.current.position.y,
      positionZ: cameraRef.current.position.z,
      targetX: targetRef.current.x,
      targetY: targetRef.current.y,
      targetZ: targetRef.current.z,
      rotationX: cameraControlsRef.current.targetRotationX,
      rotationY: cameraControlsRef.current.targetRotationY,
      up: cameraRef.current.up.clone(),
    };
  };
  // Tween the camera to frame a single object (its world bounding box), keeping
  // the current view direction.  Used by Solo so the soloed object fills the
  // view.
  controls.frameObject = (itemId) => {
    const mesh = objectsRef.current?.[itemId];
    const camera = cameraRef.current;
    if (!mesh || !camera) return;
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(
      box.getBoundingSphere(new THREE.Sphere()).radius,
      0.001,
    );
    // Preserve the current orbit direction (camera → target), just change how
    // far back the camera sits so the bbox sphere fits the frustum.
    const dir = camera.position.clone().sub(targetRef.current);
    if (dir.lengthSq() < 1e-9) dir.set(0, 0, 1);
    dir.normalize();
    let dist;
    if (camera.isPerspectiveCamera) {
      const vFov = (camera.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1));
      dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.2;
    } else {
      dist = radius * 3;
    }
    cameraAnimRef.current = {
      startPos: camera.position.clone(),
      endPos: center.clone().add(dir.multiplyScalar(dist)),
      startTarget: targetRef.current.clone(),
      endTarget: center.clone(),
      startUp: camera.up.clone(),
      endUp: camera.up.clone(),
      startTime: Date.now(),
      duration: 400,
    };
  };

  controls.restoreView = (saved) => {
    if (!saved || !cameraRef.current || !cameraControlsRef.current) return;
    const camera = cameraRef.current;
    const cc = cameraControlsRef.current;
    cameraAnimRef.current = {
      startPos: camera.position.clone(),
      endPos: new THREE.Vector3(
        saved.positionX,
        saved.positionY,
        saved.positionZ,
      ),
      startTarget: targetRef.current.clone(),
      endTarget: new THREE.Vector3(saved.targetX, saved.targetY, saved.targetZ),
      startUp: camera.up.clone(),
      endUp: saved.up ? saved.up.clone() : new THREE.Vector3(0, 1, 0),
      startTime: Date.now(),
      duration: 400,
      onComplete: () => {
        cc.targetRotationX = saved.rotationX;
        cc.targetRotationY = saved.rotationY;
        setRotationState(cameraRef.current.quaternion.clone());
      },
    };
  };
}
