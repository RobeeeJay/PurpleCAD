// Hatched section caps for the cross-section view.  Where the clip plane cuts
// a solid, the cut face is left open by clipping alone — this fills it with a
// hatched cap using the standard stencil technique:
//
//   1. For every clipped object, render its back faces (incrementing the
//      stencil) and front faces (decrementing), depth-test off, colour off,
//      clipped by the same plane.  After this the stencil is non-zero exactly
//      where the plane passes through a solid interior.
//   2. Render one big quad lying on the plane with a diagonal-hatch shader,
//      masked to stencil != 0, then clear the stencil.
//
// Module-singleton (one scene / renderer, like the store + OCC kernel).  The
// stencil meshes reuse each object's geometry at its world matrix; the cap
// quad + all meshes are re-posed to the live plane each frame.

import * as THREE from "three";

// Neutral engineering-section colours: a mid-grey fill with darker hatch lines.
const CAP_FILL_COLOR = 0x9aa0a8;
const CAP_LINE_COLOR = 0x2a2a2a;

let capsGroup = null;
let stencilGroup = null; // holds the per-object back/front stencil meshes
let capMesh = null;
let attachedScene = null;

const _Z = new THREE.Vector3(0, 0, 1);
const _pt = new THREE.Vector3();

const HATCH_FRAGMENT = `
  uniform vec3 uLine;
  uniform vec3 uFill;
  void main() {
    // Screen-space diagonal hatching — stable as the model rotates.
    float spacing = 9.0;
    float thickness = 1.5;
    float d = mod(gl_FragCoord.x + gl_FragCoord.y, spacing);
    float line = smoothstep(thickness, 0.0, min(d, spacing - d));
    gl_FragColor = vec4(mix(uFill, uLine, line), 1.0);
  }
`;
const HATCH_VERTEX = `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const stencilBaseMaterial = (side, op) => {
  const m = new THREE.MeshBasicMaterial();
  m.depthWrite = false;
  m.depthTest = false;
  m.colorWrite = false;
  m.stencilWrite = true;
  m.stencilFunc = THREE.AlwaysStencilFunc;
  m.side = side;
  m.stencilFail = op;
  m.stencilZFail = op;
  m.stencilZPass = op;
  return m;
};

// Lazily create the caps group + cap quad, attached to `scene`.
export function ensureCaps(scene) {
  if (capsGroup && attachedScene === scene) return;
  if (capsGroup && attachedScene) attachedScene.remove(capsGroup);

  capsGroup = new THREE.Group();
  capsGroup.visible = false;
  stencilGroup = new THREE.Group();
  capsGroup.add(stencilGroup);

  const capMat = new THREE.ShaderMaterial({
    uniforms: {
      uLine: { value: new THREE.Color(CAP_LINE_COLOR) },
      uFill: { value: new THREE.Color(CAP_FILL_COLOR) },
    },
    vertexShader: HATCH_VERTEX,
    fragmentShader: HATCH_FRAGMENT,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: 0,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp,
    stencilZFail: THREE.ReplaceStencilOp,
    stencilZPass: THREE.ReplaceStencilOp,
  });
  capMesh = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), capMat);
  capMesh.renderOrder = 2;
  // Reset the stencil after the cap draws so the next frame starts clean even
  // if autoClearStencil is disabled by a render pass.
  capMesh.onAfterRender = (renderer) => renderer.clearStencil();
  capsGroup.add(capMesh);

  scene.add(capsGroup);
  attachedScene = scene;
}

const disposeStencilMeshes = () => {
  if (!stencilGroup) return;
  [...stencilGroup.children].forEach((m) => {
    stencilGroup.remove(m);
    m.material.dispose();
  });
};

// Rebuild the per-object stencil meshes for the given cappable meshes (the
// caller pre-filters out sketches + analytic primitives).
export function rebuildCaps(meshes, plane) {
  if (!stencilGroup) return;
  disposeStencilMeshes();
  meshes.forEach((mesh) => {
    if (!mesh.geometry || !mesh.visible) return;
    const back = new THREE.Mesh(
      mesh.geometry,
      stencilBaseMaterial(THREE.BackSide, THREE.IncrementWrapStencilOp),
    );
    const front = new THREE.Mesh(
      mesh.geometry,
      stencilBaseMaterial(THREE.FrontSide, THREE.DecrementWrapStencilOp),
    );
    [back, front].forEach((m) => {
      m.material.clippingPlanes = [plane];
      m.matrixAutoUpdate = false;
      m.renderOrder = 1;
      m.userData.capSource = mesh;
      stencilGroup.add(m);
    });
  });
}

export function setCapsEnabled(on) {
  if (capsGroup) capsGroup.visible = on;
}

// Per-frame: align the stencil meshes to their source objects and lay the cap
// quad on the live plane.
export function updateCaps(plane, target) {
  if (!capsGroup || !capsGroup.visible) return;
  stencilGroup.children.forEach((m) => {
    m.matrix.copy(m.userData.capSource.matrixWorld);
  });
  capMesh.position.copy(plane.coplanarPoint(_pt));
  capMesh.quaternion.setFromUnitVectors(_Z, plane.normal);
  capMesh.updateMatrix();
}
