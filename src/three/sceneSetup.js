import * as THREE from "three";

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
  container.appendChild(renderer.domElement);
  return renderer;
}

export function createLights(scene, camera) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dir1 = new THREE.DirectionalLight(0xffffff, 1.0);
  dir1.position.set(10, 15, 10);
  dir1.castShadow = true;
  camera.add(dir1);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.5);
  dir2.position.set(-10, 10, -10);
  camera.add(dir2);
  const pt = new THREE.PointLight(0xffffff, 0.3, 50);
  pt.position.set(0, 10, 0);
  camera.add(pt);
}

export function createGrid(scene) {
  const gridMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uCameraPos: { value: new THREE.Vector3() },
      uGridColor: { value: new THREE.Vector3(0.45, 0.45, 0.45) },
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
      void main() {
        vec2 coord = vWorldPos.xz;
        vec2 g1 = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
        float fine = 1.0 - min(min(g1.x, g1.y), 1.0);
        vec2 g5 = abs(fract(coord / 5.0 - 0.5) - 0.5) / fwidth(coord / 5.0);
        float coarse = 1.0 - min(min(g5.x, g5.y), 1.0);
        float dist = length(vWorldPos.xz - uCameraPos.xz);
        float fadeFine   = 1.0 - smoothstep(8.0,  45.0, dist);
        float fadeCoarse = 1.0 - smoothstep(20.0, 80.0, dist);
        float alpha = max(coarse * fadeCoarse, fine * fadeFine * 0.6);
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
  return { gridPlane, gridMaterial };
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
