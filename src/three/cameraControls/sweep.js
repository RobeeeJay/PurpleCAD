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
// (so revolve tracks sketch edits, like chamfer/push-pull).
const buildRevolveSource = (profile) => ({
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

  // ── Hover ─────────────────────────────────────────────────────────────────
  const handleSweepHover = (screenX, screenY) => {
    const sm = useStore.getState().sweepSelectMode;
    if (!sm) return;
    if (!sm.profile) {
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
    // Axis phase: highlight the candidate axis line.
    const cand = findAxis(screenX, screenY, sm.profile);
    if (cand) showAxisHighlight(cand.world);
    else clearAxisHighlight();
  };

  // ── Click ─────────────────────────────────────────────────────────────────
  const handleSweepClick = (screenX, screenY) => {
    const store = useStore.getState();
    const sm = store.sweepSelectMode;
    if (!sm) return;
    if (!sm.profile) {
      const fills = extrudeSelectGroupRef?.current?.children ?? [];
      const hit = ray(screenX, screenY).intersectObjects(fills, false)[0];
      const prof = hit?.object?.userData?.extrudeProfile;
      if (prof) {
        dimFill(hoveredFill, false);
        hoveredFill = null;
        store.setSweepProfile(prof);
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

    const { positions, normals, indices } = result.geometryData;
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

    const { position, rotation } = chamferResultTransform(
      source,
      result.centerOffset,
    );

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
    group.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0);
    scene.add(group);
    previewGroup = group;
  };

  const runPreview = async () => {
    const myRequest = ++requestId;
    const sm = useStore.getState().sweepSelectMode;
    if (!sm || !sm.profile || !sm.axis) return;
    await showRevolve({
      myRequest,
      source: buildRevolveSource(sm.profile),
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

  // Debounced — safe to call on every param/selection change.
  const updateSweepPreview = () => {
    const sm = useStore.getState().sweepSelectMode;
    clearTimeout(previewTimer);
    if (!sm || !sm.profile || !sm.axis) {
      clearSweepPreview();
      return;
    }
    previewTimer = setTimeout(runPreview, PREVIEW_DEBOUNCE_MS);
  };

  // ── Commit ────────────────────────────────────────────────────────────────
  const commitSweep = async () => {
    const store = useStore.getState();
    const sm = store.sweepSelectMode;
    if (!sm || sm.kind !== "revolve" || !sm.profile || !sm.axis) return;
    const source = buildRevolveSource(sm.profile);
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
