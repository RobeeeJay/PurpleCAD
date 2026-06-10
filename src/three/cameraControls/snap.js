// Snap helpers for sketch drawing/editing: the magenta snap-point ring
// indicator, nearest-snap-point hit test (screen-space threshold), and the
// translucent Line2 preview-line factory.  Owns the single snap-indicator mesh.

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { getSnapPoints } from "../sceneObjects.js";
import { SNAP_POINT_COLOR, SNAP_PREVIEW_COLOR } from "../theme.js";

export function createSnapHelpers({ scene, renderer, cameraRef }) {
  let currentSnapIndicator = null;

  const clearSnapIndicator = () => {
    if (currentSnapIndicator) {
      scene.remove(currentSnapIndicator);
      currentSnapIndicator.geometry.dispose();
      currentSnapIndicator.material.dispose();
      currentSnapIndicator = null;
    }
  };

  const showSnapIndicator = (snapLocal, sketchMesh) => {
    clearSnapIndicator();
    const SNAP_R = 0.18;
    const toW = (x, y) => {
      const v = new THREE.Vector3(x, y, 0.006);
      v.applyQuaternion(sketchMesh.quaternion);
      v.add(sketchMesh.position);
      return v;
    };
    const circlePts = Array.from({ length: 17 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return toW(
        snapLocal.x + Math.cos(a) * SNAP_R,
        snapLocal.y + Math.sin(a) * SNAP_R,
      );
    });
    const geo = new THREE.BufferGeometry().setFromPoints(circlePts);
    const mat = new THREE.LineBasicMaterial({
      color: SNAP_POINT_COLOR,
      depthTest: false,
    });
    currentSnapIndicator = new THREE.Line(geo, mat);
    currentSnapIndicator.renderOrder = 1005;
    scene.add(currentSnapIndicator);
  };

  const findSnap = (screenX, screenY, shapes, sketchMesh, thresholdPx = 14) => {
    if (!shapes || shapes.length === 0) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const snapPts = getSnapPoints(shapes);
    let best = null;
    let bestDist = thresholdPx;
    for (const pt of snapPts) {
      const world = new THREE.Vector3(pt.x, pt.y, 0.003);
      world.applyQuaternion(sketchMesh.quaternion);
      world.add(sketchMesh.position);
      const ndc = world.clone().project(cameraRef.current);
      const sx = ((ndc.x + 1) / 2) * rect.width + rect.left;
      const sy = ((-ndc.y + 1) / 2) * rect.height + rect.top;
      const dist = Math.hypot(screenX - sx, screenY - sy);
      if (dist < bestDist) {
        bestDist = dist;
        best = pt;
      }
    }
    return best;
  };

  const makePreviewLine2 = (
    pts,
    color = SNAP_PREVIEW_COLOR,
    opacity = 0.75,
  ) => {
    if (pts.length < 2) return null;
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const mat = new LineMaterial({
      color,
      linewidth: 1.5,
      transparent: true,
      opacity,
      depthTest: false,
      resolution: renderer.getSize(new THREE.Vector2()),
    });
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 1002;
    return line;
  };

  return { clearSnapIndicator, showSnapIndicator, findSnap, makePreviewLine2 };
}
