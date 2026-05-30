// Constraint icon overlays: builds the little THREE.js glyphs (coincident
// diamonds, distance dimension lines + labels, on-line ticks, H/V diamonds,
// angle arcs + degree labels) shown for each sketch constraint, plus the
// drag-time rebuild.  Split out of sketchOverlays.js to keep that file focused
// on the shape/region geometry.

import * as THREE from "three";
import { MM_PER_UNIT } from "./dimensions.js";
import { resolveConstraintDistance } from "../geometryParams.js";
import { getShapePoint } from "./sketchShapes.js";

// Builds constraint icon THREE.js objects into `group`. All objects are tagged
// with userData.isConstraintObj so they can be found and replaced during drag.
export function addConstraintIconsToGroup(
  group,
  constraints,
  shapes,
  toWorld,
  res,
  showDimensions = true,
) {
  const R = 0.14;
  constraints.forEach((c, ci) => {
    const tag = (obj, iconLocalPos, shapeIndices, color) => {
      obj.userData.isConstraintObj = true;
      obj.userData.isConstraint = true;
      obj.userData.constraintIdx = ci;
      obj.userData.constraintType = c.type;
      obj.userData.constraintIconLocalPos = iconLocalPos;
      obj.userData.constraintShapeIndices = shapeIndices;
      obj.userData.constraintColor = color;
    };
    const addTagged = (obj) => {
      obj.userData.isConstraintObj = true;
      obj.userData.constraintIdx = ci;
      obj.userData.constraintType = c.type;
      group.add(obj);
    };

    if (c.type === "coincident") {
      const shapeA = shapes[c.shapeAIdx];
      if (!shapeA) return;
      const pt = getShapePoint(shapeA, c.pointA);
      if (!pt) return;
      const cLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          toWorld(pt.x, pt.y + R, 0.005),
          toWorld(pt.x + R, pt.y, 0.005),
          toWorld(pt.x, pt.y - R, 0.005),
          toWorld(pt.x - R, pt.y, 0.005),
          toWorld(pt.x, pt.y + R, 0.005),
        ]),
        new THREE.LineBasicMaterial({ color: 0xffaa00, depthTest: false }),
      );
      cLine.renderOrder = 1004;
      tag(cLine, { x: pt.x, y: pt.y }, [c.shapeAIdx, c.shapeBIdx], 0xffaa00);
      group.add(cLine);
    } else if (c.type === "distance") {
      if (!showDimensions) return;
      const sA = shapes[c.shapeAIdx],
        sB = shapes[c.shapeBIdx];
      if (!sA || !sB) return;
      const isRadius =
        c.shapeAIdx === c.shapeBIdx &&
        c.pointB === "edge" &&
        sA.type === "circle";
      const posA = getShapePoint(sA, c.pointA),
        posB = getShapePoint(sB, c.pointB);
      if (!posA || !posB) return;
      const wA = toWorld(posA.x, posA.y, 0.006),
        wB = toWorld(posB.x, posB.y, 0.006);
      const dir = new THREE.Vector3().subVectors(wB, wA).normalize();
      const perp = new THREE.Vector3(-dir.y, dir.x, 0)
        .normalize()
        .multiplyScalar(0.1);
      const distShapes =
        c.shapeAIdx === c.shapeBIdx
          ? [c.shapeAIdx]
          : [c.shapeAIdx, c.shapeBIdx];
      // For radius: extend line beyond circle edge; label sits outside the circle.
      // For linear: standard midpoint label with ticks at both ends.
      const wLineTo = isRadius ? wB.clone().addScaledVector(dir, 0.35) : wB;
      const dimLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([wA, wLineTo]),
        new THREE.LineBasicMaterial({ color: 0xffdd44, depthTest: false }),
      );
      dimLine.renderOrder = 1004;
      const midLocal = { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 };
      tag(dimLine, midLocal, distShapes, 0xffdd44);
      group.add(dimLine);
      // Tick marks: radius gets one at edge only; linear gets one at each endpoint.
      const tickPts = isRadius ? [wB] : [wA, wB];
      for (const pt of tickPts) {
        const t = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            pt.clone().sub(perp),
            pt.clone().add(perp),
          ]),
          new THREE.LineBasicMaterial({ color: 0xffdd44, depthTest: false }),
        );
        t.renderOrder = 1004;
        addTagged(t);
      }
      // Label position: radius → outside circle edge; linear → offset from midpoint.
      // c.distance may be a number or a formula string; evaluate before display.
      const resolvedDist = resolveConstraintDistance(c);
      // When the constraint's value is a formula (any string that isn't a
      // bare number), surface it on the label so the user can see which
      // variable / expression drives the dimension.  A bare-number string
      // ("10.5") is shown as just the mm value, matching the legacy look.
      const valueMm = (resolvedDist * MM_PER_UNIT).toFixed(1);
      const formulaSrc =
        typeof c.distance === "string" &&
        !/^-?\d+(\.\d+)?$/.test(c.distance.trim())
          ? c.distance.trim()
          : null;
      const labelText =
        (isRadius ? "R " : "") +
        (formulaSrc ? `${formulaSrc} = ${valueMm}mm` : `${valueMm}mm`);
      const canvas = document.createElement("canvas");
      const tmpCtx = canvas.getContext("2d");
      const labelFont = "bold 18px sans-serif";
      tmpCtx.font = labelFont;
      // Measure first so longer formula labels don't get clipped at the
      // edges; pad each side by 12px for the rounded background.
      const measured = tmpCtx.measureText(labelText).width;
      canvas.width = Math.max(160, Math.ceil(measured) + 24);
      canvas.height = 32;
      const ctx2d = canvas.getContext("2d");
      ctx2d.fillStyle = "rgba(40,30,0,0.85)";
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      ctx2d.fillStyle = "#ffee88";
      ctx2d.font = labelFont;
      ctx2d.textAlign = "center";
      ctx2d.textBaseline = "middle";
      ctx2d.fillText(labelText, canvas.width / 2, canvas.height / 2);
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, depthTest: false }),
      );
      // Sprite world-size scales with the canvas's aspect ratio so longer
      // formula labels stay readable instead of being squished.
      const baseW = isRadius ? 0.85 : 0.7;
      const aspect = canvas.width / 160;
      sprite.scale.set(baseW * aspect, 0.175, 1);
      if (isRadius) {
        sprite.position.copy(wLineTo.clone().addScaledVector(dir, 0.45));
      } else {
        const mid = new THREE.Vector3().addVectors(wA, wB).multiplyScalar(0.5);
        sprite.position.copy(mid.clone().addScaledVector(perp, 3));
      }
      sprite.renderOrder = 1009;
      addTagged(sprite);
    } else if (c.type === "onLine") {
      const lineShape = shapes[c.lineShapeIdx];
      const ptShape = shapes[c.pointShapeIdx];
      if (!lineShape || lineShape.type !== "line" || !ptShape) return;
      const pt = getShapePoint(ptShape, c.pointKey);
      if (!pt) return;
      const dx = lineShape.x2 - lineShape.x1,
        dy = lineShape.y2 - lineShape.y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-10) return;
      const nx = (-dy / len) * R,
        ny = (dx / len) * R;
      const tLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          toWorld(pt.x + nx, pt.y + ny, 0.005),
          toWorld(pt.x - nx, pt.y - ny, 0.005),
        ]),
        new THREE.LineBasicMaterial({ color: 0x00aaff, depthTest: false }),
      );
      tLine.renderOrder = 1004;
      tag(
        tLine,
        { x: pt.x, y: pt.y },
        [c.pointShapeIdx, c.lineShapeIdx],
        0x00aaff,
      );
      group.add(tLine);
    } else if (c.type === "horizontal" || c.type === "vertical") {
      const shape = shapes[c.shapeIdx];
      if (!shape || shape.type !== "line") return;
      const mx = (shape.x1 + shape.x2) / 2,
        my = (shape.y1 + shape.y2) / 2;
      const cLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          toWorld(mx, my + R, 0.005),
          toWorld(mx + R, my, 0.005),
          toWorld(mx, my - R, 0.005),
          toWorld(mx - R, my, 0.005),
          toWorld(mx, my + R, 0.005),
        ]),
        new THREE.LineBasicMaterial({ color: 0x00ddaa, depthTest: false }),
      );
      cLine.renderOrder = 1004;
      tag(cLine, { x: mx, y: my }, [c.shapeIdx], 0x00ddaa);
      group.add(cLine);
    } else if (c.type === "angle") {
      const sA = shapes[c.shapeAIdx],
        sB = shapes[c.shapeBIdx];
      if (!sA || sA.type !== "line" || !sB || sB.type !== "line") return;
      const P = getShapePoint(sA, c.pointA);
      const oA = getShapePoint(sA, c.pointA === "start" ? "end" : "start");
      const oB = getShapePoint(sB, c.pointB === "start" ? "end" : "start");
      if (!P || !oA || !oB) return;
      const aF = Math.atan2(oA.y - P.y, oA.x - P.x);
      let delta = Math.atan2(oB.y - P.y, oB.x - P.x) - aF;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      const AR = 0.45;
      const arcPts = [];
      for (let s = 0; s <= 16; s++) {
        const ang = aF + delta * (s / 16);
        arcPts.push(
          toWorld(P.x + Math.cos(ang) * AR, P.y + Math.sin(ang) * AR, 0.005),
        );
      }
      const arc = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(arcPts),
        new THREE.LineBasicMaterial({ color: 0xff66cc, depthTest: false }),
      );
      arc.renderOrder = 1004;
      tag(arc, { x: P.x, y: P.y }, [c.shapeAIdx, c.shapeBIdx], 0xff66cc);
      group.add(arc);
      if (showDimensions) {
        const deg = typeof c.angle === "number" ? c.angle : parseFloat(c.angle);
        const labelText = `${Math.round(deg)}°`;
        const canvas = document.createElement("canvas");
        canvas.width = 96;
        canvas.height = 32;
        const ctx2d = canvas.getContext("2d");
        ctx2d.fillStyle = "rgba(40,10,30,0.85)";
        ctx2d.fillRect(0, 0, canvas.width, canvas.height);
        ctx2d.fillStyle = "#ff99dd";
        ctx2d.font = "bold 18px sans-serif";
        ctx2d.textAlign = "center";
        ctx2d.textBaseline = "middle";
        ctx2d.fillText(labelText, canvas.width / 2, canvas.height / 2);
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(canvas),
            depthTest: false,
          }),
        );
        sprite.scale.set(0.45, 0.15, 1);
        const midAng = aF + delta / 2;
        sprite.position.copy(
          toWorld(
            P.x + Math.cos(midAng) * (AR + 0.3),
            P.y + Math.sin(midAng) * (AR + 0.3),
            0.006,
          ),
        );
        sprite.renderOrder = 1009;
        addTagged(sprite);
      }
    }
  });
}

// Removes existing constraint icon objects from the group and rebuilds them
// based on the provided current shapes (used during drag to keep icons live).
export function rebuildConstraintIconsForDrag(
  group,
  constraints,
  shapes,
  sketchMesh,
  renderer,
  showDimensions = true,
) {
  const toRemove = group.children.filter((c) => c.userData.isConstraintObj);
  toRemove.forEach((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    }
    group.remove(obj);
  });
  if (!constraints.length) return;
  const res = renderer
    ? renderer.getSize(new THREE.Vector2())
    : new THREE.Vector2(window.innerWidth, window.innerHeight);
  const toWorld = (lx, ly, z = 0.003) => {
    const v = new THREE.Vector3(lx, ly, z);
    v.applyQuaternion(sketchMesh.quaternion);
    v.add(sketchMesh.position);
    return v;
  };
  addConstraintIconsToGroup(
    group,
    constraints,
    shapes,
    toWorld,
    res,
    showDimensions,
  );
}
