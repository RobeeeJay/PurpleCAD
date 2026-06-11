// Prototype in-app path-traced render (option 1: three-gpu-pathtracer).
//
// The live viewport scene can't be path traced directly — the sphere/cylinder/
// torus are box-hulls + SDF shaders, and the path tracer only understands real
// triangle geometry + standard PBR materials.  So we build a dedicated "render
// scene": real geometry for every solid (primitives substituted with three.js
// primitive geometries at the same transform), MeshPhysicalMaterial from each
// item's material, a ground plane, and a procedural studio-lighting equirect
// environment.  The WebGLPathTracer accumulates samples while the camera is
// still and resets when it moves, and a denoise pass smooths the result before
// it hits the canvas.  Module-singleton, like the cross-section helpers.

import * as THREE from "three";
import { WebGLPathTracer, DenoiseMaterial } from "three-gpu-pathtracer";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { useStore } from "../store";
import { DEFAULT_MESH_COLOR } from "./theme.js";
import { buildStudioEnvTexture } from "./pathTraceEnv.js";

let pathTracer = null;
let renderScene = null;
let envTexture = null;
let denoiseQuad = null;
let activeCamera = null;
let rafId = null;
const lastCamMatrix = new THREE.Matrix4();

// three-gpu-pathtracer 0.0.23 reads scene.environmentRotation / backgroundRotation
// (Euler properties added in three r163) — undefined in our three 0.157, which
// crashes makeRotationFromEuler even in the tracer's internal empty scene.
// Shim them as lazily-created per-instance identity Eulers (the tracer only
// reads them; we never rotate the environment).
let rotationShimInstalled = false;
const installSceneRotationShim = () => {
  if (rotationShimInstalled) return;
  rotationShimInstalled = true;
  const proto = THREE.Scene.prototype;
  ["environmentRotation", "backgroundRotation"].forEach((key) => {
    if (key in proto) return;
    const slot = `_${key}`;
    Object.defineProperty(proto, key, {
      configurable: true,
      get() {
        return (this[slot] ??= new THREE.Euler());
      },
      set(v) {
        this[slot] = v;
      },
    });
  });
};

// Real geometry standing in for each item's display mesh.  Primitive constants
// match the analytic shaders / raycasters (sphere r=1.5, cylinder r=1 h=2,
// torus R=1 r=0.4); everything else reuses the live mesh's own geometry.
const renderGeometryFor = (item, mesh) => {
  switch (item.type) {
    case "sphere":
      return new THREE.SphereGeometry(1.5, 64, 32);
    case "cylinder":
      return new THREE.CylinderGeometry(1, 1, 2, 64);
    case "torus":
      return new THREE.TorusGeometry(1.0, 0.4, 32, 96);
    default:
      return mesh.geometry; // cube / extrude / csg already have real geometry
  }
};

// The path tracer merges every geometry into one BVH, which requires identical
// attribute sets — but OCC extrude/CSG geometry has no uv while the three.js
// primitives do.  Return a CLONE carrying exactly position+normal+uv (so the
// merge is consistent AND we never dispose the live mesh's geometry on
// teardown).
const normalizeGeometry = (geo) => {
  const g = geo.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "uv")
      g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    const n = g.attributes.position.count;
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  return g;
};

const materialFor = (materialProps) => {
  const opacity = materialProps.opacity ?? 1;
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(materialProps.color ?? DEFAULT_MESH_COLOR),
    metalness: materialProps.metalness ?? 0.3,
    roughness: materialProps.roughness ?? 0.5,
    clearcoat: materialProps.clearcoat ?? 0,
    clearcoatRoughness: materialProps.clearcoatRoughness ?? 0,
    // Map transparency to transmission so glassy materials refract in the trace.
    transmission: opacity < 1 ? 1 - opacity : 0,
    ior: 1.5,
    thickness: opacity < 1 ? 1 : 0,
  });
};

const buildRenderScene = (objectsRef, itemsRef) => {
  const scene = new THREE.Scene();
  const items = itemsRef.current;
  const defaultMaterial = useStore.getState().defaultMaterial;

  let minY = Infinity;
  Object.values(objectsRef.current).forEach((mesh) => {
    const item = items.find((i) => i.id === mesh.userData.itemId);
    if (!item || item.type === "sketch" || item.visible === false) return;
    const geometry = normalizeGeometry(renderGeometryFor(item, mesh));
    const m = new THREE.Mesh(
      geometry,
      materialFor(item.material ?? defaultMaterial),
    );
    m.position.copy(mesh.position);
    m.quaternion.copy(mesh.quaternion);
    m.scale.copy(mesh.scale);
    m.updateMatrixWorld(true);
    scene.add(m);
    const box = new THREE.Box3().setFromObject(m);
    if (box.min.y < minY) minY = box.min.y;
  });

  // Ground plane just below the lowest object, for contact shadows + a floor.
  if (Number.isFinite(minY)) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshPhysicalMaterial({ color: 0x202024, roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = minY - 0.01;
    ground.updateMatrixWorld(true);
    scene.add(ground);
  }

  // The path tracer importance-samples an equirectangular environment (it reads
  // the texture's pixel data) — a PMREM texture has none, so use the tracer's
  // own gradient equirect for soft sky/ground lighting.
  scene.environment = envTexture;
  scene.background = new THREE.Color(0x15151a);
  return scene;
};

export function isPathTracing() {
  return !!pathTracer;
}

// Build the render scene + path tracer for the current objects.  Idempotent-ish:
// rebuilds from scratch each call (cheap relative to tracing).
export function enablePathTracer(renderer, camera, { objectsRef, itemsRef }) {
  if (!envTexture) {
    envTexture = buildStudioEnvTexture();
  }

  disposeRenderScene();
  renderScene = buildRenderScene(objectsRef, itemsRef);

  try {
    installSceneRotationShim();
    // three 0.157 has no WebGLRenderer.compileAsync (added in a later three);
    // the tracer uses it only to pre-compile its quad shader.  three compiles
    // lazily on first render anyway, so resolve immediately.
    if (typeof renderer.compileAsync !== "function") {
      renderer.compileAsync = () => Promise.resolve();
    }
    if (!pathTracer) {
      pathTracer = new WebGLPathTracer(renderer);
      pathTracer.renderScale = 0.75; // a touch faster; raise to 1 for final
      pathTracer.bounces = 5;
      // Replace the default canvas blit with the bundled smart-denoise pass —
      // smooths the still-converging accumulation buffer so early samples
      // don't look as grainy.
      denoiseQuad = new FullScreenQuad(new DenoiseMaterial());
      denoiseQuad.material.sigma = 2;
      pathTracer.renderToCanvasCallback = (target, r, quad) => {
        denoiseQuad.material.map = target.texture;
        const currentAutoClear = r.autoClear;
        r.autoClear = false;
        denoiseQuad.render(r);
        r.autoClear = currentAutoClear;
      };
    }
    pathTracer.setScene(renderScene, camera);
    activeCamera = camera;
    lastCamMatrix.copy(camera.matrixWorld);
  } catch (err) {
    // Surface the failure and fall back to the raster view rather than leaving
    // the canvas frozen (the main loop only stops rendering once we mark the
    // tracer active below).
    console.error("Path tracer failed to start:", err);
    useStore
      .getState()
      .showNotification?.(
        "Path-traced render failed to start — see the console. Falling back to the raster view.",
      );
    disablePathTracer();
    useStore.setState({ pathTraceView: false });
    return;
  }

  // The main animate loop only skips its raster render once this is true, so a
  // failed start above can never freeze the view.
  useStore.setState({ pathTracerActive: true });

  // Own RAF loop so the heavy tracer stays out of the main animate loop.
  // Idempotent: only one loop.
  if (rafId == null) {
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      if (!pathTracer || !activeCamera) return;
      try {
        if (!lastCamMatrix.equals(activeCamera.matrixWorld)) {
          lastCamMatrix.copy(activeCamera.matrixWorld);
          pathTracer.updateCamera();
        }
        pathTracer.renderSample();
      } catch (err) {
        console.error("Path tracer render error:", err);
        useStore
          .getState()
          .showNotification?.(
            "Path-traced render error — see the console. Falling back to the raster view.",
          );
        disablePathTracer();
        useStore.setState({ pathTraceView: false });
      }
    };
    tick();
  }
}

const disposeRenderScene = () => {
  if (!renderScene) return;
  renderScene.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    }
  });
  renderScene = null;
};

export function disablePathTracer() {
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  disposeRenderScene();
  if (denoiseQuad) {
    denoiseQuad.material.dispose();
    denoiseQuad.dispose();
    denoiseQuad = null;
  }
  pathTracer = null;
  activeCamera = null;
  useStore.setState({ pathTracerActive: false });
}
