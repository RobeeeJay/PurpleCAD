import * as THREE from "three";
import { MM_PER_UNIT } from "./sceneObjects/dimensions.js";

export function createScene(theme) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme === "light" ? 0xe8e8e8 : 0x1a1a1a);
  return scene;
}

export function createCamera(projectionMode, aspect, savedState, targetRef) {
  const frustumSize = 20;
  let camera;
  if (projectionMode === "isometric") {
    camera = new THREE.OrthographicCamera(
      (-frustumSize * aspect) / 2,
      (frustumSize * aspect) / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      1000,
    );
  } else {
    camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 1000);
  }
  camera.position.set(
    savedState.positionX,
    savedState.positionY,
    savedState.positionZ,
  );
  camera.lookAt(targetRef.current);
  return camera;
}

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  // Compile shadow-aware shaders up-front; the runtime toggle controls
  // whether the directional light actually casts (and whether the
  // ground-plane shadow receiver is visible), not whether the renderer
  // supports it.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  return renderer;
}

// Shadow-receiver plane at Y=0.  Uses ShadowMaterial so the plane itself
// stays invisible — only shadow contribution is rendered.  Off by default;
// Viewport flips visibility when the user enables shadows.
export function createShadowGround(scene) {
  const geo = new THREE.PlaneGeometry(2000, 2000);
  const mat = new THREE.ShadowMaterial({ opacity: 0.35 });
  // Don't write to the depth buffer: the shadow receiver is coplanar with
  // the grid at Y=0.  A depth write here causes the grid to fail its own
  // depth test (floating-point ties resolve inconsistently) and vanish.
  mat.depthWrite = false;
  const plane = new THREE.Mesh(geo, mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0;
  plane.receiveShadow = true;
  plane.visible = false;
  plane.userData.isShadowGround = true;
  plane.renderOrder = -1;
  scene.add(plane);
  return plane;
}

export function createLights(scene, camera) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dir1 = new THREE.DirectionalLight(0xffffff, 1.0);
  dir1.position.set(10, 15, 10);
  // Disabled by default — the Render-section shadow toggle flips this on.
  // Without these orthographic-camera frustum settings the default shadow
  // camera covers a tiny 10-unit cube which clips the scene and produces
  // a near-black ground plane.
  dir1.castShadow = false;
  dir1.shadow.mapSize.set(1024, 1024);
  dir1.shadow.camera.left = -25;
  dir1.shadow.camera.right = 25;
  dir1.shadow.camera.top = 25;
  dir1.shadow.camera.bottom = -25;
  dir1.shadow.camera.near = 0.5;
  dir1.shadow.camera.far = 80;
  dir1.shadow.bias = -0.0005;
  dir1.shadow.normalBias = 0.02;
  camera.add(dir1);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.5);
  dir2.position.set(-10, 10, -10);
  camera.add(dir2);
  const pt = new THREE.PointLight(0xffffff, 0.3, 50);
  pt.position.set(0, 10, 0);
  camera.add(pt);
  // Return dir1 so the Viewport can toggle castShadow at runtime.
  return { dir1 };
}

// Three size tiers: "coarse" (50 mm labels), "fine" (10 mm), "ultra" (1 mm).
// The authored scale is cached on userData.baseScale so the per-frame
// constant-screen-size pass in animateLoop can multiply rather than compound.
// ultra (1 mm) renders at the same size the fine (10 mm) tier used to, so the
// 1 mm labels read as clearly as the 10 mm ones; fine is then enlarged 30% to
// stay the more prominent of the two when both are visible.
const RULER_TIERS = {
  coarse: { fontSize: 26, lineWidth: 4, scaleX: 1.0, scaleY: 0.25 },
  fine: { fontSize: 18, lineWidth: 3, scaleX: 1.365, scaleY: 0.34125 },
  ultra: { fontSize: 18, lineWidth: 3, scaleX: 1.05, scaleY: 0.2625 },
};

function makeRulerSprite(text, tier = "coarse") {
  const t = RULER_TIERS[tier];
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 40;
  const ctx = canvas.getContext("2d");
  ctx.font = `bold ${t.fontSize}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // White outline keeps text legible on dark backgrounds.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.lineWidth = t.lineWidth;
  ctx.strokeText(text, 80, 20);
  ctx.fillStyle = "rgba(40, 40, 40, 1.0)";
  ctx.fillText(text, 80, 20);
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    depthTest: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(t.scaleX, t.scaleY, 1);
  sprite.userData.baseScale = { x: t.scaleX, y: t.scaleY, z: 1 };
  sprite.userData.isRulerLabel = true;
  sprite.renderOrder = 1;
  return sprite;
}

export function createGrid(scene) {
  const gridMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uCameraPos: { value: new THREE.Vector3() },
      uGridColor: { value: new THREE.Vector3(0.45, 0.45, 0.45) },
      // 0 → no 1 mm grid, 1 → fully shown; driven by animateLoop to match the
      // 1 mm ruler tier's zoom threshold.
      uUltraFade: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      uniform vec3 uCameraPos;
      uniform vec3 uGridColor;
      uniform float uUltraFade;
      void main() {
        vec2 coord = vWorldPos.xz;
        vec2 g1 = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
        float fine = 1.0 - min(min(g1.x, g1.y), 1.0);
        vec2 g5 = abs(fract(coord / 5.0 - 0.5) - 0.5) / fwidth(coord / 5.0);
        float coarse = 1.0 - min(min(g5.x, g5.y), 1.0);
        vec2 g01 = abs(fract(coord / 0.1 - 0.5) - 0.5) / fwidth(coord / 0.1);
        float ultra = 1.0 - min(min(g01.x, g01.y), 1.0);
        float dist = length(vWorldPos.xz - uCameraPos.xz);
        float fadeFine   = 1.0 - smoothstep(8.0,  45.0, dist);
        float fadeCoarse = 1.0 - smoothstep(20.0, 80.0, dist);
        // Lighter than the 10 mm lines (0.3 vs 0.6), and only when zoomed in.
        float ultraA = ultra * fadeFine * 0.3 * uUltraFade;
        float alpha = max(max(coarse * fadeCoarse, fine * fadeFine * 0.6), ultraA);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uGridColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const gridPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    gridMaterial,
  );
  gridPlane.rotation.x = -Math.PI / 2;
  scene.add(gridPlane);

  // Ruler labels along X (at Z offset) and Z (at X offset) axes, split into
  // three zoom tiers that animateLoop shows/hides by camera view height:
  //   coarse — every 5 units (50 mm), ±500 mm: always visible
  //   fine   — every 1 unit (10 mm), ±500 mm: hidden when zoomed far out
  //   ultra  — every 0.1 unit (1 mm), ±50 mm: shown only when zoomed far in
  // The ultra tier is range-limited to ±50 mm to keep the sprite count
  // bounded (1 mm detail is only useful when zoomed tight near the origin).
  const rulerGroup = new THREE.Group();
  const coarseGroup = new THREE.Group();
  const fineGroup = new THREE.Group();
  const ultraGroup = new THREE.Group();
  ultraGroup.visible = false; // revealed by animateLoop on deep zoom-in
  const COARSE = 5; // scene units per coarse square
  const COUNT = 10; // coarse squares in each direction (±500 mm total)
  const FINE_TOTAL = COUNT * COARSE; // 50 units = 500 mm
  const ULTRA_TOTAL = 50; // tenths of a unit = ±50 units of 0.1 → ±50 mm
  const AXIS_OFFSET = 0.7;
  const Y = 0.05;

  const addPair = (group, pos, tier) => {
    const labelText = `${Math.round(pos * MM_PER_UNIT)}mm`;
    const sx = makeRulerSprite(labelText, tier);
    sx.position.set(pos, Y, AXIS_OFFSET);
    group.add(sx);
    const sz = makeRulerSprite(labelText, tier);
    sz.position.set(AXIS_OFFSET, Y, pos);
    group.add(sz);
  };

  for (let i = 1; i <= COUNT; i++) {
    for (const sign of [1, -1])
      addPair(coarseGroup, sign * i * COARSE, "coarse");
  }
  for (let i = 1; i <= FINE_TOTAL; i++) {
    if (i % COARSE === 0) continue; // coarse lines already labelled above
    for (const sign of [1, -1]) addPair(fineGroup, sign * i, "fine");
  }
  for (let i = 1; i <= ULTRA_TOTAL; i++) {
    if (i % 10 === 0) continue; // 10 mm multiples already in the fine tier
    for (const sign of [1, -1]) addPair(ultraGroup, (sign * i) / 10, "ultra");
  }

  rulerGroup.add(coarseGroup, fineGroup, ultraGroup);
  rulerGroup.userData.fineGroup = fineGroup;
  rulerGroup.userData.ultraGroup = ultraGroup;
  scene.add(rulerGroup);

  return { gridPlane, gridMaterial, rulerGroup };
}

export function createAxisGroup(scene) {
  const AXIS_R = 0.028;
  const AXIS_LEN = 2.5;
  const CONE_R = 0.065;
  const CONE_H = 0.35;
  const LABEL_DIST = AXIS_LEN + CONE_H + 0.3;

  const axisGroup = new THREE.Group();

  const addAxisArrow = (color, shaftEuler, shaftPos, conePos) => {
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(AXIS_R, AXIS_R, AXIS_LEN, 8),
      mat,
    );
    shaft.rotation.copy(shaftEuler);
    shaft.position.copy(shaftPos);
    shaft.renderOrder = 997;
    axisGroup.add(shaft);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(CONE_R, CONE_H, 8),
      mat.clone(),
    );
    cone.rotation.copy(shaftEuler);
    cone.position.copy(conePos);
    cone.renderOrder = 997;
    axisGroup.add(cone);
  };

  addAxisArrow(
    0xff4444,
    new THREE.Euler(0, 0, -Math.PI / 2),
    new THREE.Vector3(AXIS_LEN / 2, 0, 0),
    new THREE.Vector3(AXIS_LEN + CONE_H / 2, 0, 0),
  );
  addAxisArrow(
    0x4488ff,
    new THREE.Euler(0, 0, 0),
    new THREE.Vector3(0, AXIS_LEN / 2, 0),
    new THREE.Vector3(0, AXIS_LEN + CONE_H / 2, 0),
  );
  addAxisArrow(
    0x44ff44,
    new THREE.Euler(Math.PI / 2, 0, 0),
    new THREE.Vector3(0, 0, AXIS_LEN / 2),
    new THREE.Vector3(0, 0, AXIS_LEN + CONE_H / 2),
  );

  const makeAxisLabel = (text, color) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.font = "bold 48px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 32, 32);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        depthTest: false,
      }),
    );
    sprite.scale.set(0.5, 0.5, 0.5);
    return sprite;
  };

  const xLabel = makeAxisLabel("X", "#ff4444");
  xLabel.position.set(LABEL_DIST, 0, 0);
  axisGroup.add(xLabel);
  const yLabel = makeAxisLabel("Y", "#4488ff");
  yLabel.position.set(0, LABEL_DIST, 0);
  axisGroup.add(yLabel);
  const zLabel = makeAxisLabel("Z", "#44ff44");
  zLabel.position.set(0, 0, LABEL_DIST);
  axisGroup.add(zLabel);

  scene.add(axisGroup);
  return axisGroup;
}

export function createOrbitIndicator(scene) {
  const geo = new THREE.SphereGeometry(0.07, 16, 12);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 999;
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, geo, mat };
}

export function setupResize(containerRef, cameraRef, renderer, composerRef) {
  const handleResize = () => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const cam = cameraRef.current;
    if (!cam) return;
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
    renderer.setSize(width, height);
    if (composerRef.current) composerRef.current.setSize(width, height);
  };
  window.addEventListener("resize", handleResize);
  return () => window.removeEventListener("resize", handleResize);
}
