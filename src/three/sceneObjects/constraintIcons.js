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
  // The sketch plane's normal in world space (toWorld maps sketch-local → world,
  // so local +Z is the normal).  Dimension offsets take the perpendicular IN the
  // plane via cross(normal, dir) — a world-XY perpendicular only works when the
  // sketch sits on the world XY plane and otherwise pushes the dimension out of
  // the plane (or to NaN for a line along world Z).
  const sketchNormal = toWorld(0, 0, 1)
    .sub(toWorld(0, 0, 0))
    .normalize();
  // Offset constraints created together share an offsetGroup; render only one
  // editable dimension label per group (they all carry the same distance).
  const seenOffsetGroups = new Set();
  constraints.forEach((c, ci) => {
    const tag = (obj, iconLocalPos, shapeIndices, color) => {
      obj.userData.isConstraintObj = true;
      obj.userData.isConstraint = true;
      obj.userData.constraintIdx = ci;
      obj.userData.constraintType = c.type;
      obj.userData.constraintIconLocalPos = iconLocalPos;
      obj.userData.constraintShapeIndices = shapeIndices;
      obj.userData.constraintColor = color;
      // Annotations are overlays: never frustum-cull them, or an offset
      // dimension whose line/arrows sit outside a tight settled view gets the
      // whole object dropped and the dimension vanishes.
      obj.frustumCulled = false;
    };
    const addTagged = (obj) => {
      obj.userData.isConstraintObj = true;
      obj.userData.constraintIdx = ci;
      obj.userData.constraintType = c.type;
      obj.frustumCulled = false;
      group.add(obj);
    };
    // Recenter a small glyph's geometry on a world anchor and park the object
    // there, so the animate loop can scale it about that point to a constant
    // on-screen size (the geometry is otherwise baked in absolute world coords).
    // Only for fixed-size marks — NOT the dimension/leader lines, which must
    // keep spanning the measured geometry.
    const markFixedSize = (obj, anchor) => {
      if (obj.geometry) obj.geometry.translate(-anchor.x, -anchor.y, -anchor.z);
      obj.position.copy(anchor);
      obj.frustumCulled = false;
      obj.userData.constraintMark = true;
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
      markFixedSize(cLine, toWorld(pt.x, pt.y, 0.005));
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
      // In-plane perpendicular (works on any sketch plane, not just world XY).
      const perpU = sketchNormal.clone().cross(dir).normalize();
      const distShapes =
        c.shapeAIdx === c.shapeBIdx
          ? [c.shapeAIdx]
          : [c.shapeAIdx, c.shapeBIdx];
      const DIM_COLOR = 0xffdd44;
      // A plain world-space dimension/extension line (scales with zoom so it
      // keeps spanning the measured geometry — not a fixed-size mark).
      const addSeg = (p0, p1) => {
        const l = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([p0, p1]),
          new THREE.LineBasicMaterial({ color: DIM_COLOR, depthTest: false }),
        );
        l.renderOrder = 1004;
        addTagged(l);
        return l;
      };
      // A filled triangular arrowhead, tip at `tip`, opening toward `toward`.
      // markFixedSize keeps it a constant on-screen size like a real dimension.
      const addArrow = (tip, toward) => {
        const HEAD_LEN = 0.2,
          HEAD_W = 0.07;
        const base = tip.clone().addScaledVector(toward, HEAD_LEN);
        const geo = new THREE.BufferGeometry().setFromPoints([
          tip.clone(),
          base.clone().addScaledVector(perpU, HEAD_W),
          base.clone().addScaledVector(perpU, -HEAD_W),
        ]);
        const head = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({
            color: DIM_COLOR,
            depthTest: false,
            side: THREE.DoubleSide,
          }),
        );
        head.renderOrder = 1005;
        addTagged(head);
        markFixedSize(head, tip);
      };

      let labelPos;
      if (isRadius) {
        // Radius: leader from the centre out past the arc, arrowhead at the arc.
        const wLineTo = wB.clone().addScaledVector(dir, 0.35);
        const leader = addSeg(wA, wLineTo);
        tag(
          leader,
          { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 },
          distShapes,
          DIM_COLOR,
        );
        addArrow(wB, dir.clone().negate());
        labelPos = wLineTo.clone().addScaledVector(dir, 0.45);
      } else {
        // Linear: a dimension line offset from the geometry, bounded by two
        // extension (witness) lines, with an arrowhead at each end pointing out
        // to the witnesses — the value breaks the line at the middle.
        const OFF = 0.55,
          GAP = 0.06,
          OVER = 0.14;
        const A2 = wA.clone().addScaledVector(perpU, OFF);
        const B2 = wB.clone().addScaledVector(perpU, OFF);
        addSeg(
          wA.clone().addScaledVector(perpU, GAP),
          A2.clone().addScaledVector(perpU, OVER),
        );
        addSeg(
          wB.clone().addScaledVector(perpU, GAP),
          B2.clone().addScaledVector(perpU, OVER),
        );
        const dimLine = addSeg(A2, B2);
        // Hotspot for double-click sits on the dimension line, in sketch-local.
        const llen = Math.hypot(posB.x - posA.x, posB.y - posA.y) || 1;
        const lpx = -(posB.y - posA.y) / llen,
          lpy = (posB.x - posA.x) / llen;
        tag(
          dimLine,
          {
            x: (posA.x + posB.x) / 2 + lpx * OFF,
            y: (posA.y + posB.y) / 2 + lpy * OFF,
          },
          distShapes,
          DIM_COLOR,
        );
        addArrow(A2, dir);
        addArrow(B2, dir.clone().negate());
        labelPos = new THREE.Vector3().addVectors(A2, B2).multiplyScalar(0.5);
      }
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
      sprite.position.copy(labelPos);
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
      markFixedSize(tLine, toWorld(pt.x, pt.y, 0.005));
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
      markFixedSize(cLine, toWorld(mx, my, 0.005));
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
      markFixedSize(arc, toWorld(P.x, P.y, 0.005));
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
    } else if (c.type === "offset") {
      if (!showDimensions) return;
      if (c.offsetGroup != null) {
        if (seenOffsetGroups.has(c.offsetGroup)) return;
        seenOffsetGroups.add(c.offsetGroup);
      }
      const nl = shapes[c.shapeIdx];
      if (!nl || nl.type !== "line") return;
      const midLocal = { x: (nl.x1 + nl.x2) / 2, y: (nl.y1 + nl.y2) / 2 };
      // Signed value: the sign of the offset distance is meaningful (which
      // side the copy sits on), so keep it on the label.
      const resolvedDist = resolveConstraintDistance(c);
      const valueMm = (resolvedDist * MM_PER_UNIT).toFixed(1);
      const formulaSrc =
        typeof c.distance === "string" &&
        !/^-?\d+(\.\d+)?$/.test(c.distance.trim())
          ? c.distance.trim()
          : null;
      const labelText = formulaSrc
        ? `${formulaSrc} = ${valueMm}mm`
        : `${valueMm}mm`;
      const canvas = document.createElement("canvas");
      const tmpCtx = canvas.getContext("2d");
      const labelFont = "bold 18px sans-serif";
      tmpCtx.font = labelFont;
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
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(canvas),
          depthTest: false,
        }),
      );
      sprite.scale.set(0.7 * (canvas.width / 160), 0.175, 1);
      sprite.position.copy(toWorld(midLocal.x, midLocal.y, 0.006));
      sprite.renderOrder = 1009;
      // Tag with the icon's local position so the double-click hit-test can
      // find it and open the edit overlay.
      tag(sprite, midLocal, [c.shapeIdx, c.origIdx], 0xffdd44);
      group.add(sprite);
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
