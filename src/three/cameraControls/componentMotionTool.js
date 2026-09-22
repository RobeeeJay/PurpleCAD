// Component motion in the 3D view: turning the dialog's pick into an axis,
// drawing that axis while the dialog is open, and playing a component's motion
// -- moving its bodies' meshes, checking for collisions, and marking where one
// happened.  The animation is display only: meshes are moved from their rest
// pose and put back when the motion stops; the model is never changed.  State
// lives in store/motionSlice.js, the maths in ../componentMotion.js.

import * as THREE from "three";
import { useStore } from "../../store";
import {
  componentMembers,
  motionMatrix,
  motionValueAt,
  referenceFromPick,
} from "../componentMotion.js";
import {
  collisionGeometry,
  findCollision,
  restContacts,
} from "../componentCollision.js";
import { requestRender } from "../renderRequest.js";

const AXIS_COLOR = 0x6c3fd4;
const COLLISION_COLOR = 0xff2020;
// The collision ring's size on screen, as a fraction of the view's height.
const RING_SCREEN_FRACTION = 0.035;
const SOLID_TYPES_SKIPPED = new Set(["sketch", "plane"]);

export function createComponentMotionHelpers({
  scene,
  objectsRef,
  itemsRef,
  cameraRef,
}) {
  // ── The reference pick ────────────────────────────────────────────────────
  const onPick = (sel) => {
    const mesh = objectsRef.current[sel.itemId];
    if (!mesh) return;
    mesh.updateMatrixWorld(true);
    const ref = referenceFromPick(sel, mesh.matrixWorld.elements);
    const store = useStore.getState();
    if (ref) store.setMotionReference(ref);
    else
      store.setToolError(
        "That doesn't define an axis — pick a flat face, a straight edge or a hole's rim.",
      );
  };

  // ── The axis preview while the dialog is open ─────────────────────────────
  let axisObj = null;
  const clearAxis = () => {
    if (!axisObj) return;
    scene.remove(axisObj);
    axisObj.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    axisObj = null;
  };
  const drawAxis = (ref) => {
    clearAxis();
    if (!ref) return;
    const o = new THREE.Vector3(ref.origin.x, ref.origin.y, ref.origin.z);
    const d = new THREE.Vector3(ref.dir.x, ref.dir.y, ref.dir.z).normalize();
    const len = 4;
    axisObj = new THREE.Group();
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        o.clone().addScaledVector(d, -len),
        o.clone().addScaledVector(d, len),
      ]),
      new THREE.LineDashedMaterial({
        color: AXIS_COLOR,
        dashSize: 0.15,
        gapSize: 0.1,
        depthTest: false,
      }),
    );
    line.computeLineDistances();
    line.renderOrder = 1010;
    axisObj.add(line);
    const arrow = new THREE.ArrowHelper(d, o, 1.2, AXIS_COLOR, 0.3, 0.18);
    arrow.traverse((c) => {
      if (c.material) c.material.depthTest = false;
      c.renderOrder = 1011;
    });
    axisObj.add(arrow);
    axisObj.userData.isMotionAxis = true;
    scene.add(axisObj);
    requestRender();
  };

  // ── Playing ───────────────────────────────────────────────────────────────
  // folderId -> { elapsed, last, ignore:Set, restChecked }
  const runs = new Map();
  let raf = null;
  let ring = null;

  const bodyOf = (id) => {
    const mesh = objectsRef.current[id];
    const item = itemsRef.current.find((i) => i.id === id);
    if (!mesh?.isMesh || !item || SOLID_TYPES_SKIPPED.has(item.type))
      return null;
    if (item.visible === false || mesh.visible === false) return null;
    // A primitive's stand-in surface is built once and kept on its mesh.
    if (!mesh.userData.collisionGeometry)
      mesh.userData.collisionGeometry = collisionGeometry(mesh, item);
    mesh.updateMatrixWorld(true);
    return {
      id,
      geometry: mesh.userData.collisionGeometry,
      matrixWorld: mesh.matrixWorld,
    };
  };

  // Move one mesh by M from where it rests.
  const place = (mesh, M) => {
    if (!mesh.userData.motionRest) {
      mesh.updateMatrix();
      mesh.userData.motionRest = mesh.matrix.clone();
    }
    const m = M.clone().multiply(mesh.userData.motionRest);
    m.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.updateMatrixWorld(true);
  };
  const rest = (mesh) => {
    if (!mesh?.userData.motionRest) return;
    mesh.userData.motionRest.decompose(
      mesh.position,
      mesh.quaternion,
      mesh.scale,
    );
    delete mesh.userData.motionRest;
    mesh.updateMatrixWorld(true);
  };

  const clearRing = () => {
    if (!ring) return;
    scene.remove(ring);
    ring.geometry.dispose();
    ring.material.dispose();
    ring = null;
  };
  const showRing = (point) => {
    clearRing();
    ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 48),
      new THREE.MeshBasicMaterial({
        color: COLLISION_COLOR,
        depthTest: false,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    ring.position.set(point.x, point.y, point.z);
    ring.renderOrder = 1020;
    ring.userData.isCollisionMarker = true;
    scene.add(ring);
    sizeRing();
  };
  // Facing the camera, the same size on screen at any zoom.
  const sizeRing = () => {
    if (!ring) return;
    const cam = cameraRef.current;
    ring.quaternion.copy(cam.quaternion);
    const h = cam.isOrthographicCamera
      ? (cam.top - cam.bottom) / cam.zoom
      : 2 *
        cam.position.distanceTo(ring.position) *
        Math.tan((cam.fov * Math.PI) / 360);
    ring.scale.setScalar(h * RING_SCREEN_FRACTION);
  };

  const membersOf = (folderId) =>
    componentMembers(itemsRef.current, useStore.getState().folders, folderId);

  const stopRun = (folderId) => {
    const run = runs.get(folderId);
    if (!run) return;
    for (const id of run.members) rest(objectsRef.current[id]);
    runs.delete(folderId);
    requestRender();
  };

  const tick = (now) => {
    raf = null;
    const state = useStore.getState();
    for (const [folderId, run] of runs) {
      const folder = state.folders.find((f) => f.id === folderId);
      const motion = folder?.motion;
      if (!motion) continue;
      const paused = state.motionCollision?.folderId === folderId;
      if (!paused) run.elapsed += Math.min(0.1, (now - run.last) / 1000);
      run.last = now;
      if (paused) continue;
      run.members = membersOf(folderId);
      const members = new Set(run.members);
      const bodies = () => ({
        moving: run.members.map(bodyOf).filter(Boolean),
        others: Object.keys(objectsRef.current)
          .map((k) => (Number.isNaN(Number(k)) ? k : Number(k)))
          .filter((id) => !members.has(id))
          .map(bodyOf)
          .filter(Boolean),
      });
      if (motion.detectCollisions && !run.restChecked) {
        // Before the first move, while every mesh is still at rest: what
        // already touches.
        const { moving, others } = bodies();
        run.ignore = restContacts(moving, others);
        run.restChecked = true;
      }
      const M = motionMatrix(motion, motionValueAt(motion, run.elapsed));
      for (const id of run.members) {
        const mesh = objectsRef.current[id];
        if (mesh) place(mesh, M);
      }
      if (motion.detectCollisions) {
        const { moving, others } = bodies();
        const hit = findCollision(moving, others, run.ignore);
        if (hit) {
          // Resuming carries on through this pair rather than stopping on it
          // again at once.
          run.ignore.add(`${hit.movingId}|${hit.otherId}`);
          state.setMotionCollision(folderId, {
            x: hit.point.x,
            y: hit.point.y,
            z: hit.point.z,
          });
        }
      }
    }
    sizeRing();
    requestRender();
    if (runs.size) raf = requestAnimationFrame(tick);
  };

  const syncRuns = (state) => {
    const playing = state.motionPlaying || {};
    for (const folderId of [...runs.keys()])
      if (!playing[folderId]) stopRun(folderId);
    for (const folderId of Object.keys(playing))
      if (!runs.has(folderId))
        runs.set(folderId, {
          elapsed: 0,
          last: performance.now(),
          ignore: new Set(),
          restChecked: false,
          members: membersOf(folderId),
        });
    if (runs.size && raf == null) raf = requestAnimationFrame(tick);
  };

  const unsubscribe = useStore.subscribe((state, prev) => {
    const tool = state.motionTool;
    if (
      tool?.picking &&
      state.selectedSubGeometry &&
      state.selectedSubGeometry !== prev.selectedSubGeometry &&
      ((state.selectedSubGeometry.edges?.length ?? 0) > 0 ||
        (state.selectedSubGeometry.faces?.length ?? 0) > 0)
    )
      onPick(state.selectedSubGeometry);
    if (
      tool !== prev.motionTool &&
      tool?.reference !== prev.motionTool?.reference
    )
      drawAxis(tool?.reference ?? null);
    if (!tool && prev.motionTool) drawAxis(null);
    if (state.motionPlaying !== prev.motionPlaying) syncRuns(state);
    if (state.motionCollision !== prev.motionCollision) {
      if (state.motionCollision) showRing(state.motionCollision.point);
      else clearRing();
      requestRender();
    }
  });

  // For the e2e suite: where things are, since none of it reaches the DOM.
  const inspect = () => ({
    playing: [...runs.keys()],
    axis: axisObj
      ? {
          origin: useStore.getState().motionTool?.reference?.origin ?? null,
        }
      : null,
    collisionMarker: ring
      ? { x: ring.position.x, y: ring.position.y, z: ring.position.z }
      : null,
  });

  const dispose = () => {
    unsubscribe();
    if (raf != null) cancelAnimationFrame(raf);
    for (const folderId of [...runs.keys()]) stopRun(folderId);
    clearAxis();
    clearRing();
  };

  return { dispose, inspect };
}
