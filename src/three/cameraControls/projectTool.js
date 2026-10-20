// Project tool: project 3D feature edges onto the active sketch plane as
// sketch geometry, each linked to its source by a projection constraint
// (tracks the source, immovable until released).  Every body's visible edges
// are projected straight onto the plane (no perspective); hovering highlights
// the projected line under the cursor and the lines connected to it, and a
// click projects those.  A marquee box projects every edge inside it.  Split out of
// cameraControls.js — attaches its methods onto the shared `controls` object,
// the same way the other interaction sub-factories do.

import * as THREE from "three";
import { useStore } from "../../store";
import { getSketchShapePoints } from "../sceneObjects.js";
import {
  featureEdgeGraph,
  decomposeFeatureEdges,
  connectedChainGroups,
  nearestChain,
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

  // Every body's visible feature edges, projected straight onto the sketch
  // plane, and grouped into connected sets.  Cached until a body or the
  // sketch moves or changes shape; rebuilt on the first hover after.
  let projected = null; // { key, chains: [{ sourceId, mw, chain, pts2d }], groups, groupOf }
  const projectedChains = (ctx) => {
    const solids = projectSolidMeshes();
    ctx.sketchMesh.updateMatrixWorld(true);
    const sig = (m) =>
      m.matrixWorld.elements.map((e) => Math.round(e * 1e4)).join(",");
    const key = [
      sig(ctx.sketchMesh),
      ...solids.map((m) => {
        m.updateMatrixWorld(true);
        return `${m.userData.itemId}:${m.geometry?.uuid}:${sig(m)}`;
      }),
    ].join("|");
    if (projected?.key === key) return projected;
    const chains = [];
    for (const solid of solids) {
      const built = bodyEdgeGraph(solid);
      if (!built) continue;
      for (const chain of decomposeFeatureEdges(built.graph)) {
        const pts2d = worldPolylineToLocal2D(
          chain,
          ctx.sketchMesh.position,
          ctx.sketchMesh.quaternion,
        );
        // An edge square to the plane projects to a point: nothing to draw.
        let len = 0;
        for (let i = 1; i < pts2d.length; i++)
          len += Math.hypot(
            pts2d[i].x - pts2d[i - 1].x,
            pts2d[i].y - pts2d[i - 1].y,
          );
        if (len < 1e-6) continue;
        chains.push({
          sourceId: solid.userData.itemId,
          mw: built.mw,
          chain,
          pts2d,
        });
      }
    }
    const groups = connectedChainGroups(chains.map((c) => c.pts2d));
    const groupOf = new Map();
    groups.forEach((g, gi) => g.forEach((i) => groupOf.set(i, gi)));
    projected = { key, chains, groups, groupOf };
    return projected;
  };

  // The connected set of projected lines under the cursor, or null: the
  // cursor's point on the sketch plane, and the projected line within a few
  // pixels of it.
  const PICK_PX = 8;
  const pickProjected = (ctx, screenX, screenY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 0, 1).applyQuaternion(ctx.sketchMesh.quaternion),
      ctx.sketchMesh.position,
    );
    const onPlane = (sx, sy) => {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        {
          x: ((sx - rect.left) / rect.width) * 2 - 1,
          y: -((sy - rect.top) / rect.height) * 2 + 1,
        },
        cameraRef.current,
      );
      const hit = new THREE.Vector3();
      return ray.ray.intersectPlane(plane, hit) ? hit : null;
    };
    const p = onPlane(screenX, screenY);
    const q = onPlane(screenX + PICK_PX, screenY);
    if (!p || !q) return null;
    const set = projectedChains(ctx);
    const [pt] = worldPolylineToLocal2D(
      [p],
      ctx.sketchMesh.position,
      ctx.sketchMesh.quaternion,
    );
    const near = nearestChain(
      set.chains.map((c) => c.pts2d),
      pt,
      p.distanceTo(q),
    );
    if (!near) return null;
    const groupIndex = set.groupOf.get(near.index);
    return {
      set,
      groupIndex,
      chains: set.groups[groupIndex].map((i) => set.chains[i]),
    };
  };

  // Click: project the connected lines under the cursor.
  controls.projectEdgeAt = (screenX, screenY) => {
    const store = useStore.getState();
    const ctx = activeSketchForProject();
    if (!ctx) return;
    const pick = pickProjected(ctx, screenX, screenY);
    if (!pick) {
      store.showNotification?.(
        "Hover over a projected edge, then click it to project.",
      );
      return;
    }
    // Each source body's chains through its own world matrix.
    const bySource = new Map();
    for (const c of pick.chains) {
      if (!bySource.has(c.sourceId))
        bySource.set(c.sourceId, { mw: c.mw, chains: [] });
      bySource.get(c.sourceId).chains.push(c.chain);
    }
    const shapes = dedupProjectedShapes(
      [...bySource].flatMap(([sourceId, { mw, chains }]) =>
        chainsToShapes(sourceId, mw, ctx.sketchMesh, chains),
      ),
    );
    if (shapes.length === 0) {
      store.showNotification?.("No projectable edges there.");
      return;
    }
    if (shapes.length > MAX_PROJECTED) {
      store.showNotification?.("Those edges are too many to project at once.");
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

  // Hover feedback: the connected projected lines under the cursor, drawn on
  // the sketch plane in gold, until the cursor leaves them or they're clicked.
  let projectHoverGroup = null;
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
    const pick = ctx ? pickProjected(ctx, screenX, screenY) : null;
    if (!pick) {
      controls.clearProjectHover();
      return;
    }
    const hoverKey = `${pick.set.key}#${pick.groupIndex}`;
    if (projectHoverGroup?.userData.hoverKey === hoverKey) return;
    controls.clearProjectHover();
    const group = new THREE.Group();
    group.userData.hoverKey = hoverKey;
    for (const c of pick.chains)
      for (const shape of fitProjectedShapes(c.pts2d)) {
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
  // How many projected lines are highlighted (0 when none), for the tests.
  controls.projectHoverCount = () =>
    projectHoverGroup ? projectHoverGroup.children.length : 0;
}
