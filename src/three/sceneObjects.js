import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createMaterial } from "./objectMaterials.js";
import { useStore } from "../store";

export const MM_PER_UNIT = 10;

export const HANDLE_CONFIGS = [
  { type: "axisX", color: 0xff4444, dir: new THREE.Vector3(1, 0, 0) },
  { type: "axisY", color: 0x4488ff, dir: new THREE.Vector3(0, 1, 0) },
  { type: "axisZ", color: 0x44ff44, dir: new THREE.Vector3(0, 0, 1) },
  { type: "scale", color: 0xffffff, dir: new THREE.Vector3(1, 1, 1).normalize() },
];

export function getObjectDimensions(itemType, uniformScale) {
  const s = uniformScale || 1;
  switch (itemType) {
    case "cube":     return { w: 2 * s, h: 2 * s, d: 2 * s };
    case "sphere":   return { w: 3 * s, h: 3 * s, d: 3 * s };
    case "cylinder": return { w: 2 * s, h: 2 * s, d: 2 * s };
    case "torus":    return { w: 2.8 * s, h: 0.8 * s, d: 2.8 * s };
    case "sketch":   return { w: 3 * s, h: 3 * s, d: 0.05 };
    default:         return { w: 2 * s, h: 2 * s, d: 2 * s };
  }
}

export function getObjectExtent(itemType, uniformScale) {
  const s = uniformScale || 1;
  switch (itemType) {
    case "sphere":   return 1.5 * s;
    case "torus":    return 1.4 * s;
    case "sketch":   return 1.5 * s;
    default:         return 1.0 * s;
  }
}

export function makeDimSprite(text, cssColor) {
  const W = 168, H = 52;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(12,12,12,0.85)";
  ctx.fillRect(3, 3, W - 6, H - 6);
  ctx.strokeStyle = cssColor; ctx.lineWidth = 2.5;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.fillStyle = cssColor;
  ctx.font = "bold 26px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.5, 0.46, 1);
  sprite.renderOrder = 1000;
  return { sprite, canvas, ctx, mat };
}

export function redrawDimSprite(dimObj, text, cssColor) {
  const { canvas, ctx, mat } = dimObj;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(12,12,12,0.85)";
  ctx.fillRect(3, 3, W - 6, H - 6);
  ctx.strokeStyle = cssColor; ctx.lineWidth = 2.5;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.fillStyle = cssColor;
  ctx.font = "bold 26px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);
  mat.map.needsUpdate = true;
}

export function placeDimLabels(boundingBox, pos, dim) {
  const { labelX, labelY, labelZ } = boundingBox;
  const GAP = 0.75;
  const hw = dim.w / 2, hh = dim.h / 2, hd = dim.d / 2;
  labelX.sprite.position.set(pos.x, pos.y + hh + GAP, pos.z - hd);
  labelY.sprite.position.set(pos.x + hw + GAP, pos.y, pos.z - hd);
  labelZ.sprite.position.set(pos.x + hw + GAP, pos.y + hh + GAP, pos.z);
}

export function makeMeasureLabel(text, cssColor) {
  const W = 120, H = 38;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = cssColor;
  ctx.font = "bold 22px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.8, 0.25, 1);
  sprite.renderOrder = 1001;
  return sprite;
}

// ── Sketch 2D shape helpers ──────────────────────────────────────────────────

export function buildSketchShape(tool, start, current) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const r = Math.sqrt(dx * dx + dy * dy);
  switch (tool) {
    case "rect":    return { type: "rect",    x1: start.x, y1: start.y, x2: current.x, y2: current.y };
    case "circle":  return { type: "circle",  cx: start.x, cy: start.y, r };
    case "ellipse": return { type: "ellipse", cx: start.x, cy: start.y, rx: Math.abs(dx), ry: Math.abs(dy) };
    case "line":    return { type: "line",    x1: start.x, y1: start.y, x2: current.x, y2: current.y };
    case "arc": {
      const startAngle = Math.atan2(dy, dx);
      return { type: "arc", cx: start.x, cy: start.y, r, startAngle, endAngle: startAngle + Math.PI / 2 };
    }
    default: return null;
  }
}

export function getSketchShapePoints(shape, sketchMesh) {
  const toWorld = (lx, ly) => {
    const v = new THREE.Vector3(lx, ly, 0.003);
    v.applyQuaternion(sketchMesh.quaternion);
    v.add(sketchMesh.position);
    return v;
  };
  switch (shape.type) {
    case "rect": {
      const { x1, y1, x2, y2 } = shape;
      return [toWorld(x1, y1), toWorld(x2, y1), toWorld(x2, y2), toWorld(x1, y2), toWorld(x1, y1)];
    }
    case "circle": {
      const { cx, cy, r } = shape;
      return Array.from({ length: 65 }, (_, i) => {
        const a = (i / 64) * Math.PI * 2;
        return toWorld(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      });
    }
    case "ellipse": {
      const { cx, cy, rx, ry } = shape;
      return Array.from({ length: 65 }, (_, i) => {
        const a = (i / 64) * Math.PI * 2;
        return toWorld(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      });
    }
    case "line":
      return [toWorld(shape.x1, shape.y1), toWorld(shape.x2, shape.y2)];
    case "arc": {
      const { cx, cy, r, startAngle, endAngle } = shape;
      return Array.from({ length: 33 }, (_, i) => {
        const a = startAngle + (i / 32) * (endAngle - startAngle);
        return toWorld(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      });
    }
    default: return [];
  }
}

export function sketchDimText(tool, start, current) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const L = Math.sqrt(dx * dx + dy * dy) * MM_PER_UNIT;
  const W = Math.abs(dx) * MM_PER_UNIT;
  const H = Math.abs(dy) * MM_PER_UNIT;
  switch (tool) {
    case "line":   return `${L.toFixed(1)} mm`;
    case "arc":    return `r ${L.toFixed(1)} mm`;
    case "circle": return `⌀ ${(L * 2).toFixed(1)} mm`;
    default:       return `W ${W.toFixed(1)}  H ${H.toFixed(1)} mm`;
  }
}

// ── Scene object building ─────────────────────────────────────────────────────

export function buildSceneObjects(items, scene, objectsRef, originalMaterialsRef) {
  Object.values(objectsRef.current).forEach((mesh) => {
    scene.remove(mesh);
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material.dispose();
    mesh.children.forEach((child) => {
      child.geometry && child.geometry.dispose();
      child.material && child.material.dispose();
    });
  });
  objectsRef.current = {};
  originalMaterialsRef.current = {};

  items.forEach((item) => {
    let geometry;
    switch (item.type) {
      case "cube":     geometry = new THREE.BoxGeometry(2, 2, 2); break;
      case "sphere":   geometry = new THREE.BoxGeometry(3, 3, 3); break;
      case "cylinder": geometry = new THREE.BoxGeometry(2, 2, 2); break;
      case "torus":    geometry = new THREE.BoxGeometry(3, 1.2, 3); break;
      case "sketch":   geometry = new THREE.PlaneGeometry(3, 3); break;
      case "csg": {
        if (!item.geometryData) return;
        const { positions, normals, indices } = item.geometryData;
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
        if (normals) geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
        if (indices) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        if (!normals) geometry.computeVertexNormals();
        break;
      }
      default: return;
    }

    const color = 0xe0e0e0;
    const material = createMaterial(item, color);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = item.type !== "sketch";
    mesh.receiveShadow = item.type !== "sketch";
    mesh.userData.itemId = item.id;
    if (["sphere", "cylinder", "torus"].includes(item.type)) {
      mesh.userData.hullGeometry = geometry;
      mesh.userData.shaderMat = material;
    }

    const p = item.position;
    mesh.position.set(p ? p.x : 0, p ? p.y : 2, p ? p.z : 0);
    mesh.scale.setScalar(item.scale ? item.scale.x : 1);
    const rot = item.rotation;
    if (rot) mesh.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);

    if (item.type === "sphere") {
      mesh.raycast = (raycaster, intersects) => {
        const worldCenter = new THREE.Vector3();
        mesh.getWorldPosition(worldCenter);
        const worldScale = new THREE.Vector3();
        mesh.getWorldScale(worldScale);
        const radius = 1.5 * worldScale.x;
        const sphere = new THREE.Sphere(worldCenter, radius);
        const target = new THREE.Vector3();
        if (!raycaster.ray.intersectSphere(sphere, target)) return;
        const dist = raycaster.ray.origin.distanceTo(target);
        if (dist < raycaster.near || dist > raycaster.far) return;
        intersects.push({ distance: dist, point: target.clone(), face: { normal: target.clone().sub(worldCenter).normalize() }, faceIndex: 0, object: mesh });
      };
    } else if (item.type === "cylinder") {
      mesh.raycast = (raycaster, intersects) => {
        const wc = new THREE.Vector3(); mesh.getWorldPosition(wc);
        const ws = new THREE.Vector3(); mesh.getWorldScale(ws);
        const radius = 1.0 * ws.x;
        const halfH  = 1.0 * ws.y;
        const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).normalize();
        const ray = raycaster.ray;
        const oc  = new THREE.Vector3().subVectors(ray.origin, wc);
        const da  = ray.direction.dot(axis);
        const oca = oc.dot(axis);
        const A = 1.0 - da * da;
        const B = 2.0 * (ray.direction.dot(oc) - da * oca);
        const C = oc.dot(oc) - oca * oca - radius * radius;
        let tHit = Infinity, nHit = null;
        if (Math.abs(A) > 1e-6) {
          const disc = B * B - 4 * A * C;
          if (disc >= 0) {
            const sq = Math.sqrt(disc);
            for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
              if (t > raycaster.near && t < tHit) {
                const p = ray.origin.clone().addScaledVector(ray.direction, t);
                const y = p.clone().sub(wc).dot(axis);
                if (Math.abs(y) <= halfH) { tHit = t; nHit = p.clone().sub(wc).addScaledVector(axis, -y).normalize(); }
              }
            }
          }
        }
        if (Math.abs(da) > 1e-6) {
          for (const sign of [1, -1]) {
            const t = (sign * halfH - oca) / da;
            if (t > raycaster.near && t < tHit) {
              const p = ray.origin.clone().addScaledVector(ray.direction, t);
              if (p.clone().sub(wc).addScaledVector(axis, -sign * halfH).lengthSq() <= radius * radius) {
                tHit = t; nHit = axis.clone().multiplyScalar(sign);
              }
            }
          }
        }
        if (tHit === Infinity || tHit > raycaster.far) return;
        intersects.push({ distance: tHit, point: ray.origin.clone().addScaledVector(ray.direction, tHit), face: { normal: nHit || axis }, faceIndex: 0, object: mesh });
      };
    } else if (item.type === "torus") {
      mesh.raycast = (raycaster, intersects) => {
        const wc = new THREE.Vector3(); mesh.getWorldPosition(wc);
        const ws = new THREE.Vector3(); mesh.getWorldScale(ws);
        const outerR = (1.0 + 0.4) * ws.x;
        const sphere = new THREE.Sphere(wc, outerR);
        const target = new THREE.Vector3();
        if (!raycaster.ray.intersectSphere(sphere, target)) return;
        const dist = raycaster.ray.origin.distanceTo(target);
        if (dist < raycaster.near || dist > raycaster.far) return;
        intersects.push({ distance: dist, point: target.clone(), face: { normal: target.clone().sub(wc).normalize() }, faceIndex: 0, object: mesh });
      };
    } else if (item.type !== "sketch") {
      mesh.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 2 }),
      ));
    }

    mesh.visible = item.visible !== false;
    scene.add(mesh);
    objectsRef.current[item.id] = mesh;
    originalMaterialsRef.current[item.id] = {
      color: new THREE.Color(color),
      metalness: 0.2,
      roughness: 0.2,
      emissive: new THREE.Color(0x000000),
    };
  });
}

// ── Transform handles + bounding box ────────────────────────────────────────

export function buildTransformHandles(selectedId, items, objectsRef) {
  const mesh = objectsRef.current[selectedId];
  if (!mesh) return null;
  const item = items.find((i) => i.id === selectedId);
  if (!item || item.type === "sketch") return null;

  const handles = [];
  const ext = getObjectExtent(item.type, mesh.scale.x);

  HANDLE_CONFIGS.forEach(({ type, color, dir }) => {
    const geo = new THREE.SphereGeometry(0.12, 10, 10);
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const hMesh = new THREE.Mesh(geo, mat);
    hMesh.renderOrder = 999;
    hMesh.userData.isHandle = true;
    hMesh.position.copy(mesh.position).addScaledVector(dir, ext + 0.5);
    handles.push({ mesh: hMesh, type, dir: dir.clone() });
  });

  const torusRadius = ext + 0.85;
  [
    { type: "rotX", color: 0xff4444, rx: 0,            ry: Math.PI / 2, rz: 0 },
    { type: "rotY", color: 0x4488ff, rx: Math.PI / 2,  ry: 0,           rz: 0 },
    { type: "rotZ", color: 0x44ff44, rx: 0,            ry: 0,           rz: 0 },
  ].forEach(({ type, color, rx, ry, rz }) => {
    const geo = new THREE.TorusGeometry(torusRadius, 0.045, 6, 64);
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, side: THREE.DoubleSide });
    const torus = new THREE.Mesh(geo, mat);
    torus.renderOrder = 998;
    torus.userData.isHandle = true;
    torus.position.copy(mesh.position);
    torus.rotation.set(rx, ry, rz);
    handles.push({ mesh: torus, type, dir: null });
  });

  const dim = getObjectDimensions(item.type, mesh.scale.x);
  const boxMesh = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: 0x88ccff, depthTest: false, transparent: true, opacity: 0.7 }),
  );
  boxMesh.renderOrder = 998;
  boxMesh.scale.set(dim.w, dim.h, dim.d);
  boxMesh.position.copy(mesh.position);

  const mmX = Math.round(dim.w * MM_PER_UNIT);
  const mmY = Math.round(dim.h * MM_PER_UNIT);
  const mmZ = Math.round(dim.d * MM_PER_UNIT);
  const labelX = makeDimSprite(mmX + "mm", "#ff4444");
  const labelY = makeDimSprite(mmY + "mm", "#4488ff");
  const labelZ = makeDimSprite(mmZ + "mm", "#44ff44");

  const boundingBox = { boxMesh, labelX, labelY, labelZ };
  placeDimLabels(boundingBox, mesh.position, dim);

  return { handles, boundingBox };
}

// ── Sketch shapes line group ─────────────────────────────────────────────────

export function buildSketchShapesGroup(selectedId, items, objectsRef) {
  const selItem = items.find((i) => i.id === selectedId);
  if (selItem?.type !== "sketch") return null;
  const sketchMesh = objectsRef.current[selectedId];
  if (!sketchMesh) return null;
  const shapes = selItem.shapes || [];
  if (shapes.length === 0) return null;

  const group = new THREE.Group();
  shapes.forEach((shape) => {
    const pts = getSketchShapePoints(shape, sketchMesh);
    if (pts.length < 2) return;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x88aaff, depthTest: false }),
    );
    line.renderOrder = 1001;
    group.add(line);
  });
  return group;
}

// ── Render mode switching ────────────────────────────────────────────────────

export function applyRenderMode(renderMode, ctx) {
  const {
    scene, renderer, cameraRef, objectsRef, originalMaterialsRef, itemsRef,
    axisGroupRef, planeRef, sketchPlacementPlanesRef, composerRef, envTextureRef,
    sketchModeRef,
  } = ctx;

  if (renderMode === "smooth") {
    if (!envTextureRef.current) {
      const pmremGen = new THREE.PMREMGenerator(renderer);
      pmremGen.compileEquirectangularShader();
      const roomEnv = new RoomEnvironment();
      envTextureRef.current = pmremGen.fromScene(roomEnv).texture;
      pmremGen.dispose();
      roomEnv.dispose();
    }
    scene.environment = envTextureRef.current;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const bgCanvas = document.createElement("canvas");
    bgCanvas.width = 2; bgCanvas.height = 512;
    const bgCtx = bgCanvas.getContext("2d");
    const grad = bgCtx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "#0a0a2e");
    grad.addColorStop(1, "#1a0828");
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, 2, 512);
    const bgTex = new THREE.CanvasTexture(bgCanvas);
    bgTex.needsUpdate = true;
    scene.background = bgTex;

    if (axisGroupRef.current) axisGroupRef.current.visible = false;
    if (planeRef.current) planeRef.current.visible = false;
    sketchPlacementPlanesRef.current.forEach(({ mesh }) => { mesh.visible = false; });

    if (!composerRef.current && cameraRef.current) {
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, cameraRef.current));
      composer.addPass(new UnrealBloomPass(
        new THREE.Vector2(renderer.domElement.clientWidth, renderer.domElement.clientHeight),
        0.25, 0.5, 0.85,
      ));
      composer.addPass(new OutputPass());
      composerRef.current = composer;
    }

    Object.values(objectsRef.current).forEach((mesh) => {
      const itemData = itemsRef.current.find((i) => i.id === mesh.userData.itemId);
      if (itemData?.type === "sketch") { mesh.visible = false; return; }
      if (["sphere", "cylinder", "torus"].includes(itemData?.type)) {
        if (mesh.userData.hullGeometry && mesh.geometry !== mesh.userData.hullGeometry) {
          mesh.geometry.dispose(); mesh.geometry = mesh.userData.hullGeometry;
        }
        if (mesh.userData.shaderMat && mesh.material !== mesh.userData.shaderMat) {
          mesh.material.dispose(); mesh.material = mesh.userData.shaderMat;
        }
        return;
      }
      const orig = originalMaterialsRef.current[mesh.userData.itemId];
      const col = orig ? orig.color.clone() : new THREE.Color(0xe0e0e0);
      if (mesh.material) mesh.material.dispose();
      mesh.material = new THREE.MeshPhysicalMaterial({
        color: col, metalness: 0.15, roughness: 0.3,
        clearcoat: 1.0, clearcoatRoughness: 0.1, envMapIntensity: 1.2,
      });
      mesh.children.forEach((child) => { child.visible = false; });
    });
  } else {
    scene.environment = null;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;
    if (composerRef.current) {
      composerRef.current.dispose();
      composerRef.current = null;
    }

    const bgColor = useStore.getState().theme === "light" ? 0xe8e8e8 : 0x1a1a1a;
    scene.background = new THREE.Color(bgColor);

    if (axisGroupRef.current) axisGroupRef.current.visible = useStore.getState().axisVisible;
    if (planeRef.current && !sketchModeRef.current) planeRef.current.visible = true;
    sketchPlacementPlanesRef.current.forEach(({ mesh }) => { mesh.visible = true; });

    Object.values(objectsRef.current).forEach((mesh) => {
      const itemData = itemsRef.current.find((i) => i.id === mesh.userData.itemId);
      if (itemData?.type === "sketch") { mesh.visible = true; return; }
      if (["sphere", "cylinder", "torus"].includes(itemData?.type)) {
        if (renderMode === "wireframe") {
          let wfGeo;
          if (itemData.type === "sphere") wfGeo = new THREE.SphereGeometry(1.5, 16, 12);
          else if (itemData.type === "cylinder") wfGeo = new THREE.CylinderGeometry(1, 1, 2, 16);
          else wfGeo = new THREE.TorusGeometry(1.0, 0.4, 12, 24);
          if (mesh.geometry !== mesh.userData.hullGeometry) mesh.geometry.dispose();
          mesh.geometry = wfGeo;
          if (mesh.material !== mesh.userData.shaderMat) mesh.material.dispose();
          mesh.material = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, wireframe: true });
        } else {
          if (mesh.userData.hullGeometry && mesh.geometry !== mesh.userData.hullGeometry) {
            mesh.geometry.dispose(); mesh.geometry = mesh.userData.hullGeometry;
          }
          if (mesh.userData.shaderMat && mesh.material !== mesh.userData.shaderMat) {
            mesh.material.dispose(); mesh.material = mesh.userData.shaderMat;
          }
        }
        return;
      }
      const orig = originalMaterialsRef.current[mesh.userData.itemId];
      const col = orig ? orig.color.clone() : new THREE.Color(0xe0e0e0);
      if (mesh.material) mesh.material.dispose();
      mesh.material = new THREE.MeshStandardMaterial({ color: col, metalness: 0.3, roughness: 0.5 });
      mesh.material.wireframe = renderMode === "wireframe";
      mesh.children.forEach((child) => { child.visible = true; });
    });
  }
}
