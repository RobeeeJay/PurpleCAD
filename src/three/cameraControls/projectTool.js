// Project tool: project 3D feature edges onto the active sketch plane as
// sketch geometry, each linked to its source by a projection constraint
// (tracks the source, immovable until released).  A click projects all
// connected edges of the body under the cursor; a marquee box projects every
// edge inside it; hover previews what a click would project.  Split out of
// cameraControls.js — attaches its methods onto the shared `controls` object,
// the same way the other interaction sub-factories do.

import * as THREE from "three";
import { useStore } from "../../store";
import { getSketchShapePoints } from "../sceneObjects.js";
import {
  featureEdgeGraph,
  edgePolylineNear,
  decomposeFeatureEdges,
  worldPolylineToLocal2D,
  fitProjectedShapes,
  dedupProjectedShapes,
} from "../sketchProjection.js";

export function createProjectTool({
  scene,
  renderer,
  cameraRef,
  objectsRef,
  itemsRef,
  controls,
  // The active sketch + its mesh (or null) — shared with the Text-tool preview,
  // so it's owned by cameraControls.js and passed in.
  activeSketchForProject,
}) {
  const projectSolidMeshes = () =>
    Object.values(objectsRef.current).filter((m) => {
      const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
      return it && it.type !== "sketch";
    });
  // World feature-edge graph of a solid mesh, plus its world matrix.  Bails on a
  // mesh too dense to graph cheaply (an imported/high-res body would freeze).
  const MAX_PROJECT_TRIS = 40000;
  const bodyEdgeGraph = (solid) => {
    solid.updateMatrixWorld(true);
    const posAttr = solid.geometry?.getAttribute("position");
    if (!posAttr) return null;
    const idx = solid.geometry.getIndex();
    if ((idx ? idx.count : posAttr.count) / 3 > MAX_PROJECT_TRIS) return null;
    const mw = solid.matrixWorld;
    const tmp = new THREE.Vector3();
    const positions = new Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      tmp.fromBufferAttribute(posAttr, i).applyMatrix4(mw);
      positions[i * 3] = tmp.x;
      positions[i * 3 + 1] = tmp.y;
      positions[i * 3 + 2] = tmp.z;
    }
    const idxAttr = solid.geometry.getIndex();
    const indices = idxAttr ? Array.from(idxAttr.array) : null;
    // The sketch plane's world normal (toward the viewer) — keep only edges on a
    // face that faces it, so hidden back edges aren't projected.
    const ctx = activeSketchForProject();
    let planeNormal = null;
    if (ctx) {
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(
        ctx.sketchMesh.quaternion,
      );
      planeNormal = { x: n.x, y: n.y, z: n.z };
    }
    return {
      graph: featureEdgeGraph(positions, indices, undefined, planeNormal),
      mw,
    };
  };
  // Fit a list of world-polyline chains belonging to one source body and return
  // their projected sketch shapes (each chain its own projection group).
  const chainsToShapes = (sourceId, mw, sketchMesh, chains) => {
    const invMw = new THREE.Matrix4().copy(mw).invert();
    const out = [];
    chains.forEach((chain) => {
      const localPolyline = chain.map((p) => {
        const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(invMw);
        return [v.x, v.y, v.z];
      });
      const pts2d = worldPolylineToLocal2D(
        chain,
        sketchMesh.position,
        sketchMesh.quaternion,
      );
      const edgeKey = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
      out.push(
        ...fitProjectedShapes(pts2d, {
          projection: {
            sourceId,
            edgeKey,
            key: `${sourceId}:${edgeKey}`,
            localPolyline,
          },
        }),
      );
    });
    return out;
  };

  // Guard against pathological bodies (a dense/faceted mesh can have thousands
  // of feature edges) — projecting that many would freeze the app.
  const MAX_PROJECTED = 300;
  // A solid's screen-space bounding box (or null), for cheaply skipping bodies
  // that can't overlap a marquee before building their (possibly huge) graph.
  const solidScreenBox = (solid, rect) => {
    const g = solid.geometry;
    if (!g) return null;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!bb) return null;
    solid.updateMatrixWorld(true);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(
        i & 1 ? bb.max.x : bb.min.x,
        i & 2 ? bb.max.y : bb.min.y,
        i & 4 ? bb.max.z : bb.min.z,
      )
        .applyMatrix4(solid.matrixWorld)
        .project(cameraRef.current);
      const sx = ((v.x + 1) / 2) * rect.width + rect.left;
      const sy = ((-v.y + 1) / 2) * rect.height + rect.top;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    return { minX, maxX, minY, maxY };
  };

  // Click: project every connected edge of the body under the cursor.
  controls.projectEdgeAt = (screenX, screenY) => {
    const store = useStore.getState();
    const ctx = activeSketchForProject();
    if (!ctx) return;
    const solids = projectSolidMeshes();
    const prevVisible = solids.map((m) => m.visible);
    solids.forEach((m) => (m.visible = true));
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const hit = ray.intersectObjects(solids, false)[0];
    solids.forEach((m, i) => (m.visible = prevVisible[i]));
    if (!hit) {
      store.showNotification?.("Click a 3D edge to project.");
      return;
    }
    const built = bodyEdgeGraph(hit.object);
    if (!built) {
      store.showNotification?.("That body is too dense to project edges from.");
      return;
    }
    // The clicked edge's connected component → its smooth chains.  (A body's
    // feature edges are one component, so this is "all connected lines".)
    let chains = decomposeFeatureEdges(built.graph);
    const nearest = edgePolylineNear(built.graph, hit.point);
    if (!chains.length && nearest) chains = [nearest];
    const shapes = dedupProjectedShapes(
      chainsToShapes(
        hit.object.userData.itemId,
        built.mw,
        ctx.sketchMesh,
        chains,
      ),
    );
    if (shapes.length === 0) {
      store.showNotification?.("No projectable edges there.");
      return;
    }
    if (shapes.length > MAX_PROJECTED) {
      store.showNotification?.(
        "That body has too many edges to project at once.",
      );
      return;
    }
    store.addProjectShapes(shapes);
    controls.previewProjection(useStore.getState().projectTool?.shapes);
  };

  // Marquee: project every feature edge whose screen midpoint falls in the box.
  controls.projectEdgesInBox = (box) => {
    const store = useStore.getState();
    const ctx = activeSketchForProject();
    if (!ctx) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const minX = Math.min(box.x1, box.x2),
      maxX = Math.max(box.x1, box.x2),
      minY = Math.min(box.y1, box.y2),
      maxY = Math.max(box.y1, box.y2);
    const inBox = (p) => {
      const ndc = new THREE.Vector3(p.x, p.y, p.z).project(cameraRef.current);
      if (ndc.z > 1) return false;
      const sx = ((ndc.x + 1) / 2) * rect.width + rect.left;
      const sy = ((-ndc.y + 1) / 2) * rect.height + rect.top;
      return sx >= minX && sx <= maxX && sy >= minY && sy <= maxY;
    };
    const allShapes = [];
    let aborted = false;
    for (const solid of projectSolidMeshes()) {
      // Skip bodies whose screen bbox can't overlap the marquee, so a dense mesh
      // off to the side isn't graphed at all.
      const sb = solidScreenBox(solid, rect);
      if (
        sb &&
        (sb.maxX < minX || sb.minX > maxX || sb.maxY < minY || sb.minY > maxY)
      )
        continue;
      const built = bodyEdgeGraph(solid);
      if (!built) continue;
      const chains = decomposeFeatureEdges(built.graph).filter((chain) =>
        inBox(chain[Math.floor(chain.length / 2)]),
      );
      if (chains.length)
        allShapes.push(
          ...chainsToShapes(
            solid.userData.itemId,
            built.mw,
            ctx.sketchMesh,
            chains,
          ),
        );
      if (allShapes.length > MAX_PROJECTED) {
        aborted = true;
        break;
      }
    }
    if (aborted) {
      store.showNotification?.(
        "Too many edges in the box — select a smaller region.",
      );
      return;
    }
    const deduped = dedupProjectedShapes(allShapes);
    if (deduped.length === 0) {
      store.showNotification?.("No edges inside the box.");
      return;
    }
    store.addProjectShapes(deduped);
    controls.previewProjection(useStore.getState().projectTool?.shapes);
  };

  // Live preview of the staged projection: the accumulated sketch shapes drawn
  // on the sketch plane (teal) before they're committed by the dialog.
  let projectionPreviewGroup = null;
  controls.clearProjectionPreview = () => {
    if (!projectionPreviewGroup) return;
    scene.remove(projectionPreviewGroup);
    projectionPreviewGroup.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    projectionPreviewGroup = null;
  };
  controls.previewProjection = (shapes) => {
    controls.clearProjectionPreview();
    const ctx = activeSketchForProject();
    if (!ctx || !shapes || shapes.length === 0) return;
    const group = new THREE.Group();
    for (const shape of shapes) {
      const pts = getSketchShapePoints(shape, ctx.sketchMesh);
      if (!pts || pts.length < 2) continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: 0x37b8a0,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        }),
      );
      line.renderOrder = 1011;
      line.frustumCulled = false;
      group.add(line);
    }
    scene.add(group);
    projectionPreviewGroup = group;
  };

  // Hover feedback: highlight the connected feature edges of the body under the
  // cursor (what a click would project).  The body's edge graph is cached so
  // sweeping across the same body doesn't rebuild it each frame.
  let projectHoverGroup = null;
  let projectHoverCache = null; // { bodyId, sig, chains }
  controls.clearProjectHover = () => {
    if (!projectHoverGroup) return;
    scene.remove(projectHoverGroup);
    projectHoverGroup.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    projectHoverGroup = null;
  };
  controls.projectHoverAt = (screenX, screenY) => {
    const ctx = activeSketchForProject();
    if (!ctx) {
      controls.clearProjectHover();
      return;
    }
    const solids = projectSolidMeshes();
    const prevVisible = solids.map((m) => m.visible);
    solids.forEach((m) => (m.visible = true));
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const hit = ray.intersectObjects(solids, false)[0];
    solids.forEach((m, i) => (m.visible = prevVisible[i]));
    if (!hit) {
      controls.clearProjectHover();
      return;
    }
    const solid = hit.object;
    const bodyId = solid.userData.itemId;
    solid.updateMatrixWorld(true);
    ctx.sketchMesh.updateMatrixWorld(true);
    const sig = `${solid.matrixWorld.elements.map((e) => Math.round(e * 1e3)).join(",")}|${ctx.sketchMesh.matrixWorld.elements.map((e) => Math.round(e * 1e3)).join(",")}`;
    const bodyKey = `${bodyId}|${sig}`;
    // The outline is fixed for a given body+sketch, so only recompute when the
    // hovered body changes — not on every mouse-move.
    if (projectHoverGroup && projectHoverGroup.userData.bodyKey === bodyKey)
      return;
    if (!projectHoverCache || projectHoverCache.bodyKey !== bodyKey) {
      const built = bodyEdgeGraph(solid);
      let shapes = [];
      if (built) {
        for (const chain of decomposeFeatureEdges(built.graph)) {
          const pts2d = worldPolylineToLocal2D(
            chain,
            ctx.sketchMesh.position,
            ctx.sketchMesh.quaternion,
          );
          shapes.push(...fitProjectedShapes(pts2d));
        }
        shapes = dedupProjectedShapes(shapes);
      }
      projectHoverCache = { bodyKey, shapes };
    }
    controls.clearProjectHover();
    if (projectHoverCache.shapes.length === 0) return;
    // Draw the would-be projection ON the sketch plane (where the user is
    // looking), in gold to distinguish it from the teal staged preview.
    const group = new THREE.Group();
    group.userData.bodyKey = bodyKey;
    for (const shape of projectHoverCache.shapes) {
      const pts = getSketchShapePoints(shape, ctx.sketchMesh);
      if (!pts || pts.length < 2) continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: 0xffcc44,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        }),
      );
      line.renderOrder = 1013;
      line.frustumCulled = false;
      group.add(line);
    }
    scene.add(group);
    projectHoverGroup = group;
  };
}
