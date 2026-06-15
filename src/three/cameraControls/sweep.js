// Sketch→solid sweep tools (Phase 1: Revolve).  Owns the in-viewport picking
// (profile loop via the extrude select fills, then an axis line in that sketch),
// a translucent live preview of the revolve result, and the Confirm-time commit
// (a new csg item carrying a `revolve` regenerator).  Mirrors the extrude
// profile-pick + the push/pull preview/commit conventions.

import * as THREE from "three";
import { useStore } from "../../store";
import { maxItemId } from "../../store/internals.js";
import { chamferResultTransform } from "./chamferCommit.js";
import { DEFAULT_MESH_COLOR, WIREFRAME_EDGE_COLOR } from "../theme.js";

const PREVIEW_DEBOUNCE_MS = 350;
const AXIS_HIGHLIGHT = 0x44aaff;

// An extrude-like source snapshot whose live polygon re-derives from the sketch
// (so the sweep tracks sketch edits, like chamfer/push-pull).  Used as the
// profile source for both revolve and pipe.
const buildProfileSource = (profile) => ({
  type: "extrude",
  depth: 0,
  position: profile.position,
  rotation: profile.rotation,
  profile: {
    sketchId: profile.sketchId,
    profileCentroid: profile.profileCentroid,
    polygon2D: profile.polygon2D,
    holes: profile.holes || [],
    position: profile.position,
    rotation: profile.rotation,
    normalWorld: profile.normalWorld,
  },
});

const angleRadOf = (params) =>
  ((Number(params?.angleDeg) || 360) * Math.PI) / 180;
const prismSidesOf = (params) =>
  params?.prism ? Math.max(3, Math.round(Number(params.sides) || 3)) : 0;

// Screen-space distance from P to segment AB.
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

export function createSweepHelpers({
  scene,
  renderer,
  cameraRef,
  objectsRef,
  itemsRef,
  extrudeSelectGroupRef,
}) {
  let previewGroup = null;
  let axisHighlight = null;
  let hoveredFill = null;
  let requestId = 0;
  let previewTimer = null;

  const ray = (sx, sy) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((sx - rect.left) / rect.width) * 2 - 1;
    const ny = -((sy - rect.top) / rect.height) * 2 + 1;
    const rc = new THREE.Raycaster();
    rc.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    return rc;
  };

  // World endpoints of a sketch line shape, via its sketch mesh transform.
  const lineWorld = (line, sketchMesh) => {
    const toW = (x, y) =>
      new THREE.Vector3(x, y, 0.004)
        .applyQuaternion(sketchMesh.quaternion)
        .add(sketchMesh.position);
    return [toW(line.x1, line.y1), toW(line.x2, line.y2)];
  };

  // Nearest axis-candidate line (in the profile's sketch) under the cursor.
  const findAxis = (screenX, screenY, profile) => {
    const sketchMesh = objectsRef.current[profile.sketchId];
    const sketch = itemsRef.current.find((i) => i.id === profile.sketchId);
    if (!sketchMesh || !sketch) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const toScreen = (x, y) => {
      const w = new THREE.Vector3(x, y, 0)
        .applyQuaternion(sketchMesh.quaternion)
        .add(sketchMesh.position);
      const ndc = w.clone().project(cameraRef.current);
      return {
        x: ((ndc.x + 1) / 2) * rect.width + rect.left,
        y: ((-ndc.y + 1) / 2) * rect.height + rect.top,
      };
    };
    let best = null;
    let bestD = 12;
    (sketch.shapes || []).forEach((s, idx) => {
      if (s.type !== "line") return;
      const a = toScreen(s.x1, s.y1);
      const b = toScreen(s.x2, s.y2);
      const d = segDist(screenX, screenY, a.x, a.y, b.x, b.y);
      if (d < bestD) {
        bestD = d;
        best = { shapeIdx: idx, world: lineWorld(s, sketchMesh) };
      }
    });
    return best;
  };

  // Nearest path-candidate line under the cursor, across ALL sketches (the pipe
  // path typically lives in a different sketch from the profile).
  const findPathLine = (screenX, screenY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    let best = null;
    let bestD = 12;
    itemsRef.current.forEach((sketch) => {
      if (sketch.type !== "sketch") return;
      const sketchMesh = objectsRef.current[sketch.id];
      if (!sketchMesh) return;
      const toScreen = (x, y) => {
        const w = new THREE.Vector3(x, y, 0)
          .applyQuaternion(sketchMesh.quaternion)
          .add(sketchMesh.position);
        const ndc = w.clone().project(cameraRef.current);
        return {
          x: ((ndc.x + 1) / 2) * rect.width + rect.left,
          y: ((-ndc.y + 1) / 2) * rect.height + rect.top,
        };
      };
      (sketch.shapes || []).forEach((s, idx) => {
        if (s.type !== "line") return;
        const a = toScreen(s.x1, s.y1);
        const b = toScreen(s.x2, s.y2);
        const d = segDist(screenX, screenY, a.x, a.y, b.x, b.y);
        if (d < bestD) {
          bestD = d;
          best = {
            sketchId: sketch.id,
            shapeIdx: idx,
            world: lineWorld(s, sketchMesh),
          };
        }
      });
    });
    return best;
  };

  const clearAxisHighlight = () => {
    if (!axisHighlight) return;
    scene.remove(axisHighlight);
    axisHighlight.geometry.dispose();
    axisHighlight.material.dispose();
    axisHighlight = null;
  };

  const showAxisHighlight = (world) => {
    clearAxisHighlight();
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(world),
      new THREE.LineBasicMaterial({ color: AXIS_HIGHLIGHT, depthTest: false }),
    );
    line.renderOrder = 1010;
    scene.add(line);
    axisHighlight = line;
  };

  const dimFill = (fill, dim) => {
    if (!fill) return;
    if (dim) {
      if (fill.userData._baseOpacity == null)
        fill.userData._baseOpacity = fill.material.opacity;
      fill.material.opacity = 0.28;
    } else if (fill.userData._baseOpacity != null) {
      fill.material.opacity = fill.userData._baseOpacity;
    }
    fill.material.needsUpdate = true;
  };

  // A fill pick is the current phase when no profile is set, or for loft's
  // second profile (loft picks two regions; revolve/pipe pick a region + line).
  const needsFillPick = (sm) =>
    !sm.profile || (sm.kind === "loft" && !sm.secondProfile);

  // ── Hover ─────────────────────────────────────────────────────────────────
  const handleSweepHover = (screenX, screenY) => {
    const sm = useStore.getState().sweepSelectMode;
    if (!sm) return;
    if (needsFillPick(sm)) {
      // Highlight the profile fill under the cursor.
      const fills = extrudeSelectGroupRef?.current?.children ?? [];
      const hit = ray(screenX, screenY).intersectObjects(fills, false)[0];
      const next = hit?.object ?? null;
      if (next !== hoveredFill) {
        dimFill(hoveredFill, false);
        dimFill(next, true);
        hoveredFill = next;
      }
      return;
    }
    // Second phase: highlight the candidate line (pipe path or revolve axis).
    const cand =
      sm.kind === "pipe"
        ? findPathLine(screenX, screenY)
        : findAxis(screenX, screenY, sm.profile);
    if (cand) showAxisHighlight(cand.world);
    else clearAxisHighlight();
  };

  // Parallel-plane test for loft (allows antiparallel normals — both define the
  // same plane orientation).
  const planesParallel = (a, b) =>
    a && b && Math.abs(a.x * b.x + a.y * b.y + a.z * b.z) > 0.999;

  // ── Click ─────────────────────────────────────────────────────────────────
  const handleSweepClick = (screenX, screenY) => {
    const store = useStore.getState();
    const sm = store.sweepSelectMode;
    if (!sm) return;
    if (needsFillPick(sm)) {
      const fills = extrudeSelectGroupRef?.current?.children ?? [];
      const hit = ray(screenX, screenY).intersectObjects(fills, false)[0];
      const prof = hit?.object?.userData?.extrudeProfile;
      if (!prof) return;
      if (!sm.profile) {
        dimFill(hoveredFill, false);
        hoveredFill = null;
        store.setSweepProfile(prof);
      } else {
        // Loft's second profile must sit on a plane parallel to the first.
        if (!planesParallel(sm.profile.normalWorld, prof.normalWorld)) {
          store.showNotification(
            "Loft needs the second sketch on a parallel plane.",
          );
          return;
        }
        dimFill(hoveredFill, false);
        hoveredFill = null;
        store.setSweepSecondProfile(prof);
        updateSweepPreview();
      }
      return;
    }
    if (sm.kind === "pipe") {
      if (!sm.path) {
        const cand = findPathLine(screenX, screenY);
        if (cand) {
          clearAxisHighlight();
          store.setSweepPath({
            sketchId: cand.sketchId,
            shapeIdx: cand.shapeIdx,
          });
          updateSweepPreview();
        }
      }
      return;
    }
    if (!sm.axis) {
      const cand = findAxis(screenX, screenY, sm.profile);
      if (cand) {
        clearAxisHighlight();
        store.setSweepAxis({
          sketchId: sm.profile.sketchId,
          shapeIdx: cand.shapeIdx,
        });
        updateSweepPreview();
      }
    }
  };

  // ── Live preview ────────────────────────────────────────────────────────
  let ghosted = null; // { mesh, opacity, edges } — the item dimmed during edit

  const unghost = () => {
    if (!ghosted) return;
    const { mesh, opacity, edges } = ghosted;
    if (mesh.material) {
      mesh.material.opacity = opacity;
      mesh.material.transparent = opacity < 1;
      mesh.material.needsUpdate = true;
    }
    edges.forEach(({ child, visible }) => (child.visible = visible));
    ghosted = null;
  };

  const ghost = (itemId) => {
    const mesh = objectsRef.current[itemId];
    if (!mesh || ghosted?.mesh === mesh) return;
    unghost();
    ghosted = {
      mesh,
      opacity: mesh.material.opacity,
      edges: mesh.children.map((c) => ({ child: c, visible: c.visible })),
    };
    mesh.material.transparent = true;
    mesh.material.opacity = 0.12;
    mesh.material.needsUpdate = true;
    mesh.children.forEach((c) => (c.visible = false));
  };

  const removePreviewGroup = () => {
    if (!previewGroup) return;
    scene.remove(previewGroup);
    previewGroup.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    previewGroup = null;
  };

  const clearSweepPreview = () => {
    requestId++;
    clearTimeout(previewTimer);
    removePreviewGroup();
    unghost();
  };

  // Build the translucent preview group (fill + outline) for a result's
  // geometry and place it at the given world transform, ghosting `ghostItemId`.
  const showPreviewMesh = (geometryData, position, rotation, ghostItemId) => {
    const { positions, normals, indices } = geometryData;
    const geometry = new THREE.BufferGeometry();
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
    if (!normals) geometry.computeVertexNormals();

    if (ghostItemId != null) ghost(ghostItemId);
    removePreviewGroup();
    const group = new THREE.Group();
    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: DEFAULT_MESH_COLOR,
        roughness: 0.55,
        metalness: 0,
        transparent: true,
        opacity: 0.85,
      }),
    );
    fill.renderOrder = 990;
    group.add(fill);
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: WIREFRAME_EDGE_COLOR,
        depthTest: false,
      }),
    );
    lines.renderOrder = 999;
    group.add(lines);
    group.position.set(position.x, position.y, position.z);
    group.rotation.set(rotation?.x || 0, rotation?.y || 0, rotation?.z || 0);
    scene.add(group);
    previewGroup = group;
  };

  // Run the revolve recipe and show its result as a translucent mesh + outline.
  // Shared by the create/retarget preview (reads sweepSelectMode) and the edit
  // preview (replays a committed regenerator with new params, ghosting `item`).
  const showRevolve = async ({
    myRequest,
    source,
    axis,
    angleRad,
    prismSides,
    ghostItemId,
  }) => {
    const printPrecision =
      useStore.getState().curveResolution === "print" ? 0.01 : null;
    let result;
    try {
      const { revolveItem } = await import("../occClient.js");
      result = await revolveItem({
        source,
        axis,
        angleRad,
        prismSides,
        allItems: itemsRef.current,
        printPrecision,
      });
    } catch {
      result = null;
    }
    if (myRequest !== requestId || !result) return;
    const { position, rotation } = chamferResultTransform(
      source,
      result.centerOffset,
    );
    showPreviewMesh(result.geometryData, position, rotation, ghostItemId);
  };

  // Run the pipe recipe; it's built in world, so place the preview at the
  // result's bbox-centre position with no rotation.
  const showPipe = async ({
    myRequest,
    profileSource,
    pathRef,
    ghostItemId,
  }) => {
    const printPrecision =
      useStore.getState().curveResolution === "print" ? 0.01 : null;
    let result;
    try {
      const { pipeItem } = await import("../occClient.js");
      result = await pipeItem({
        profileSource,
        pathRef,
        allItems: itemsRef.current,
        printPrecision,
      });
    } catch {
      result = null;
    }
    if (myRequest !== requestId || !result) return;
    showPreviewMesh(result.geometryData, result.position, null, ghostItemId);
  };

  // Run the loft recipe; built in world like pipe.
  const showLoft = async ({
    myRequest,
    profileSource,
    secondProfileSource,
    ghostItemId,
  }) => {
    const printPrecision =
      useStore.getState().curveResolution === "print" ? 0.01 : null;
    let result;
    try {
      const { loftItem } = await import("../occClient.js");
      result = await loftItem({
        profileSource,
        secondProfileSource,
        allItems: itemsRef.current,
        printPrecision,
      });
    } catch {
      result = null;
    }
    if (myRequest !== requestId || !result) return;
    showPreviewMesh(result.geometryData, result.position, null, ghostItemId);
  };

  const runPreview = async () => {
    const myRequest = ++requestId;
    const sm = useStore.getState().sweepSelectMode;
    if (!sm || !sm.profile) return;
    if (sm.kind === "pipe") {
      if (!sm.path) return;
      await showPipe({
        myRequest,
        profileSource: buildProfileSource(sm.profile),
        pathRef: sm.path,
      });
      return;
    }
    if (sm.kind === "loft") {
      if (!sm.secondProfile) return;
      await showLoft({
        myRequest,
        profileSource: buildProfileSource(sm.profile),
        secondProfileSource: buildProfileSource(sm.secondProfile),
      });
      return;
    }
    if (!sm.axis) return;
    await showRevolve({
      myRequest,
      source: buildProfileSource(sm.profile),
      axis: sm.axis,
      angleRad: angleRadOf(sm.params),
      prismSides: prismSidesOf(sm.params),
    });
  };

  // Edit-dialog preview: replay a committed revolve's stored recipe with the
  // typed params, ghosting the existing solid so the change reads clearly.
  const updateRevolveEditPreview = async (regenerator, params, itemId) => {
    const myRequest = ++requestId;
    if (regenerator?.kind !== "revolve" || !regenerator.source) {
      clearSweepPreview();
      return;
    }
    await showRevolve({
      myRequest,
      source: regenerator.source,
      axis: regenerator.axis,
      angleRad: angleRadOf(params),
      prismSides: prismSidesOf(params),
      ghostItemId: itemId,
    });
  };

  // True once a tool has all the geometry it needs to build a result.
  const sweepReady = (sm) =>
    sm &&
    sm.profile &&
    (sm.kind === "pipe"
      ? sm.path
      : sm.kind === "loft"
        ? sm.secondProfile
        : sm.axis);

  // Debounced — safe to call on every param/selection change.
  const updateSweepPreview = () => {
    const sm = useStore.getState().sweepSelectMode;
    clearTimeout(previewTimer);
    if (!sweepReady(sm)) {
      clearSweepPreview();
      return;
    }
    previewTimer = setTimeout(runPreview, PREVIEW_DEBOUNCE_MS);
  };

  // ── Commit ────────────────────────────────────────────────────────────────
  const commitPipe = async (store, sm) => {
    const profileSource = buildProfileSource(sm.profile);
    const printPrecision = store.curveResolution === "print" ? 0.01 : null;
    let result;
    try {
      const { pipeItem } = await import("../occClient.js");
      result = await pipeItem({
        profileSource,
        pathRef: sm.path,
        allItems: itemsRef.current,
        printPrecision,
      });
    } catch (err) {
      store.showNotification(err.message);
      return;
    }
    if (!result) {
      store.showNotification("Pipe produced no geometry.");
      return;
    }
    const { geometryData, centerOffset, position } = result;
    const regenerator = {
      kind: "pipe",
      profileSource,
      pathRef: sm.path,
      centerOffset,
      regeneratedAt: printPrecision,
    };
    clearSweepPreview();
    clearAxisHighlight();

    const retarget = store.sweepRetargetTarget;
    if (retarget) {
      store.retargetPipeEntry(retarget.entryId, {
        regenerator,
        geometryData,
        position,
        rotation: { x: 0, y: 0, z: 0 },
      });
      store.setSweepRetargetTarget(null);
    } else {
      const id = maxItemId(store.history) + 1;
      store.addItem({
        id,
        name: `Pipe ${id}`,
        type: "csg",
        children: [],
        regenerator,
        geometryData,
        position,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
    }
    store.setSweepSelectMode(null);
  };

  const commitLoft = async (store, sm) => {
    const profileSource = buildProfileSource(sm.profile);
    const secondProfileSource = buildProfileSource(sm.secondProfile);
    const printPrecision = store.curveResolution === "print" ? 0.01 : null;
    let result;
    try {
      const { loftItem } = await import("../occClient.js");
      result = await loftItem({
        profileSource,
        secondProfileSource,
        allItems: itemsRef.current,
        printPrecision,
      });
    } catch (err) {
      store.showNotification(err.message);
      return;
    }
    if (!result) {
      store.showNotification("Loft produced no geometry.");
      return;
    }
    const { geometryData, centerOffset, position } = result;
    const regenerator = {
      kind: "loft",
      profileSource,
      secondProfileSource,
      centerOffset,
      regeneratedAt: printPrecision,
    };
    clearSweepPreview();
    clearAxisHighlight();

    const retarget = store.sweepRetargetTarget;
    if (retarget) {
      store.retargetLoftEntry(retarget.entryId, {
        regenerator,
        geometryData,
        position,
        rotation: { x: 0, y: 0, z: 0 },
      });
      store.setSweepRetargetTarget(null);
    } else {
      const id = maxItemId(store.history) + 1;
      store.addItem({
        id,
        name: `Loft ${id}`,
        type: "csg",
        children: [],
        regenerator,
        geometryData,
        position,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });
    }
    store.setSweepSelectMode(null);
  };

  const commitSweep = async () => {
    const store = useStore.getState();
    const sm = store.sweepSelectMode;
    if (!sweepReady(sm)) return;
    if (sm.kind === "pipe") {
      await commitPipe(store, sm);
      return;
    }
    if (sm.kind === "loft") {
      await commitLoft(store, sm);
      return;
    }
    if (sm.kind !== "revolve") return;
    const source = buildProfileSource(sm.profile);
    const angleRad = angleRadOf(sm.params);
    const prismSides = prismSidesOf(sm.params);
    const printPrecision = store.curveResolution === "print" ? 0.01 : null;
    let result;
    try {
      const { revolveItem } = await import("../occClient.js");
      result = await revolveItem({
        source,
        axis: sm.axis,
        angleRad,
        prismSides,
        allItems: itemsRef.current,
        printPrecision,
      });
    } catch (err) {
      store.showNotification(err.message);
      return;
    }
    if (!result) {
      store.showNotification("Revolve produced no geometry.");
      return;
    }
    const { geometryData, centerOffset } = result;
    const { position } = chamferResultTransform(source, centerOffset);
    const regenerator = {
      kind: "revolve",
      source,
      axis: sm.axis,
      angleRad,
      prismSides,
      centerOffset,
      regeneratedAt: printPrecision,
    };
    clearSweepPreview();
    clearAxisHighlight();

    const retarget = store.sweepRetargetTarget;
    if (retarget) {
      store.retargetRevolveEntry(retarget.entryId, {
        regenerator,
        geometryData,
        position,
        rotation: source.rotation,
      });
      store.setSweepRetargetTarget(null);
    } else {
      const id = maxItemId(store.history) + 1;
      store.addItem({
        id,
        name: `Revolve ${id}`,
        type: "csg",
        children: [],
        regenerator,
        geometryData,
        position,
        rotation: source.rotation,
        scale: { x: 1, y: 1, z: 1 },
      });
    }
    store.setSweepSelectMode(null);
  };

  const cancelSweep = () => {
    clearSweepPreview();
    clearAxisHighlight();
    dimFill(hoveredFill, false);
    hoveredFill = null;
    const store = useStore.getState();
    store.setSweepSelectMode(null);
    store.setSweepRetargetTarget(null);
  };

  return {
    handleSweepHover,
    handleSweepClick,
    updateSweepPreview,
    updateRevolveEditPreview,
    clearSweepPreview,
    commitSweep,
    cancelSweep,
  };
}

// Re-open the Revolve tool to retarget a committed revolve (re-pick the
// profile/axis), seeded from its regenerator.  Mirrors beginPushPullRetarget.
export function beginRevolveRetarget(itemId, entryId) {
  const store = useStore.getState();
  const item = store.items.find((i) => i.id === itemId);
  const r = item?.regenerator;
  if (!r || r.kind !== "revolve") return;
  const p = r.source?.profile;
  store.setSweepSelectMode({
    kind: "revolve",
    profile: p
      ? {
          sketchId: p.sketchId,
          profileCentroid: p.profileCentroid,
          polygon2D: p.polygon2D,
          holes: p.holes || [],
          position: p.position,
          rotation: p.rotation,
          normalWorld: p.normalWorld,
        }
      : null,
    axis: r.axis,
    secondProfile: null,
    params: {
      angleDeg: Math.round(((r.angleRad ?? 2 * Math.PI) * 180) / Math.PI),
      prism: (r.prismSides ?? 0) >= 3,
      sides: r.prismSides >= 3 ? r.prismSides : 6,
    },
  });
  store.setSweepRetargetTarget({ itemId, entryId });
}

// Re-open the Pipe tool to retarget a committed pipe (re-pick the profile/path),
// seeded from its regenerator.  Mirrors beginRevolveRetarget.
export function beginPipeRetarget(itemId, entryId) {
  const store = useStore.getState();
  const item = store.items.find((i) => i.id === itemId);
  const r = item?.regenerator;
  if (!r || r.kind !== "pipe") return;
  const p = r.profileSource?.profile;
  store.setSweepSelectMode({
    kind: "pipe",
    profile: p
      ? {
          sketchId: p.sketchId,
          profileCentroid: p.profileCentroid,
          polygon2D: p.polygon2D,
          holes: p.holes || [],
          position: p.position,
          rotation: p.rotation,
          normalWorld: p.normalWorld,
        }
      : null,
    path: r.pathRef,
    axis: null,
    secondProfile: null,
    params: {},
  });
  store.setSweepRetargetTarget({ itemId, entryId });
}

// A profile pick-snapshot reconstructed from a stored extrude source's profile.
const profileSnapshot = (p) =>
  p
    ? {
        sketchId: p.sketchId,
        profileCentroid: p.profileCentroid,
        polygon2D: p.polygon2D,
        holes: p.holes || [],
        position: p.position,
        rotation: p.rotation,
        normalWorld: p.normalWorld,
      }
    : null;

// Re-open the Loft tool to retarget a committed loft (re-pick both profiles),
// seeded from its regenerator.  Mirrors beginPipeRetarget.
export function beginLoftRetarget(itemId, entryId) {
  const store = useStore.getState();
  const item = store.items.find((i) => i.id === itemId);
  const r = item?.regenerator;
  if (!r || r.kind !== "loft") return;
  store.setSweepSelectMode({
    kind: "loft",
    profile: profileSnapshot(r.profileSource?.profile),
    secondProfile: profileSnapshot(r.secondProfileSource?.profile),
    path: null,
    axis: null,
    params: {},
  });
  store.setSweepRetargetTarget({ itemId, entryId });
}
