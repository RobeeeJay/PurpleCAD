import * as THREE from "three";
import {
  DEFAULT_MESH_COLOR,
  EMISSIVE_HOVERED,
  EMISSIVE_MULTI_SELECTED,
  EMISSIVE_SELECTED,
  NO_EMISSIVE,
  sketchPlaneFillColorFor,
} from "./theme.js";
import { DEFAULT_MATERIAL } from "./materialPresets.js";
import { primitiveDimensions } from "./sceneObjects/dimensions.js";
import { useStore } from "../store";

// Shader uniforms carrying a primitive's parametric dimensions (object-space; the
// analytic shaders multiply by the model scale).  Updated live by the dimensions
// dialog's preview.  cone uses a generic vec for radii + half-height.
export function primitiveUniforms(item) {
  const d = primitiveDimensions(item);
  if (item.type === "sphere") return { uRadius: { value: d.radius } };
  if (item.type === "cylinder")
    return { uRadius: { value: d.radius }, uHalfH: { value: d.height / 2 } };
  if (item.type === "torus")
    return { uMajor: { value: d.major }, uMinor: { value: d.minor } };
  if (item.type === "cone")
    return {
      uRb: { value: d.radiusBottom },
      uRt: { value: d.radiusTop },
      uHalfH: { value: d.height / 2 },
    };
  return {};
}

export const SPHERE_VERTEX_SHADER = `
  uniform float uRadius;
  varying vec3 vViewPos;
  varying vec3 vSphereCenter;
  varying float vSphereRadius;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mvPos.xyz;
    vSphereCenter = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vSphereRadius = uRadius * length(modelViewMatrix[0].xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

export const SPHERE_FRAGMENT_SHADER = `
  uniform mat4 projectionMatrix;
  uniform vec3 uColor;
  uniform vec3 uEmissive;
  uniform float uOpacity;
  uniform vec3 uClipNormal;
  uniform float uClipConstant;
  uniform float uClipEnabled;
  varying vec3 vViewPos;
  varying vec3 vSphereCenter;
  varying float vSphereRadius;
  bool clipped(vec3 p) {
    return uClipEnabled > 0.5 && dot(p, uClipNormal) + uClipConstant < 0.0;
  }
  void main() {
    vec3 sc = vSphereCenter;
    float sr = vSphereRadius;
    vec3 rd = normalize(vViewPos);
    float b = dot(rd, sc);
    float c = dot(sc, sc) - sr * sr;
    float disc = b * b - c;
    if (disc < 0.0) discard;
    float sq = sqrt(disc);
    float t = b - sq;
    if (t < 0.0) t = b + sq;
    if (t < 0.0) discard;
    vec3 hit = rd * t;
    // If the near surface is on the clipped side, fall through to the far
    // (interior) surface so the cut reveals the inside rather than a hole.
    if (clipped(hit)) {
      t = b + sq;
      hit = rd * t;
      if (t < 0.0 || clipped(hit)) discard;
    }
    vec3 n = normalize(hit - sc);
    vec3 L1 = normalize(vec3(10.0, 15.0, 10.0));
    vec3 L2 = normalize(vec3(-10.0, 10.0, -10.0));
    vec3 V  = normalize(-hit);
    float d1 = max(dot(n, L1), 0.0);
    float d2 = max(dot(n, L2), 0.0) * 0.4;
    float sp = pow(max(dot(V, reflect(-L1, n)), 0.0), 12.0) * 0.06;
    vec3 col = uColor * (0.25 + d1 * 0.75 + d2) + vec3(sp) + uEmissive;
    vec4 cp = projectionMatrix * vec4(hit, 1.0);
    gl_FragDepth = cp.z / cp.w * 0.5 + 0.5;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), uOpacity);
  }
`;

export const CYLINDER_VERTEX_SHADER = `
  uniform float uRadius;
  uniform float uHalfH;
  varying vec3 vViewPos;
  varying vec3 vCylCenter;
  varying vec3 vCylAxis;
  varying float vCylRadius;
  varying float vCylHalfH;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mvPos.xyz;
    vCylCenter = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vCylAxis   = normalize(modelViewMatrix[1].xyz);
    vCylRadius = uRadius * length(modelViewMatrix[0].xyz);
    vCylHalfH  = uHalfH * length(modelViewMatrix[1].xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

export const CYLINDER_FRAGMENT_SHADER = `
  uniform mat4 projectionMatrix;
  uniform vec3 uColor;
  uniform vec3 uEmissive;
  uniform float uOpacity;
  uniform vec3 uClipNormal;
  uniform float uClipConstant;
  uniform float uClipEnabled;
  varying vec3 vViewPos;
  varying vec3 vCylCenter;
  varying vec3 vCylAxis;
  varying float vCylRadius;
  varying float vCylHalfH;
  bool clipped(vec3 p) {
    return uClipEnabled > 0.5 && dot(p, uClipNormal) + uClipConstant < 0.0;
  }
  void main() {
    vec3 sc = vCylCenter;
    vec3 a  = vCylAxis;
    float r = vCylRadius;
    float h = vCylHalfH;
    vec3 rd  = normalize(vViewPos);
    vec3 oc  = -sc;
    float da  = dot(rd, a);
    float oca = dot(oc, a);
    float A = 1.0 - da*da;
    float B = 2.0*(dot(rd, oc) - da*oca);
    float C = dot(oc, oc) - oca*oca - r*r;
    // Pick the NEAREST surface whose point isn't on the clipped side, so the
    // cut falls through to the interior (back wall / far cap) instead of a hole.
    float tHit = -1.0;
    vec3 nHit  = vec3(0.0);
    if (abs(A) > 1e-6) {
      float disc = B*B - 4.0*A*C;
      if (disc >= 0.0) {
        float sq = sqrt(disc);
        for (int si = 0; si < 2; si++) {
          float ts = (si == 0) ? (-B - sq)/(2.0*A) : (-B + sq)/(2.0*A);
          if (ts > 0.001 && (tHit < 0.0 || ts < tHit)) {
            float ys = dot(rd*ts - sc, a);
            vec3 ps = rd*ts;
            if (abs(ys) <= h && !clipped(ps)) {
              tHit = ts; nHit = normalize((rd*ts - sc) - ys*a);
            }
          }
        }
      }
    }
    if (abs(da) > 1e-6) {
      for (int ci = 0; ci < 2; ci++) {
        float capSign = (ci == 0) ? 1.0 : -1.0;
        float capH = capSign * h;
        float tCap = (capH - oca) / da;
        if (tCap > 0.001 && (tHit < 0.0 || tCap < tHit)) {
          vec3 radial = rd*tCap - sc - capH*a;
          vec3 pc = rd*tCap;
          if (dot(radial, radial) <= r*r && !clipped(pc)) {
            tHit = tCap; nHit = capSign * a;
          }
        }
      }
    }
    if (tHit < 0.0) discard;
    vec3 hit = rd * tHit;
    vec3 n = nHit;
    vec3 L1 = normalize(vec3(10.0, 15.0, 10.0));
    vec3 L2 = normalize(vec3(-10.0, 10.0, -10.0));
    vec3 V  = normalize(-hit);
    float d1 = max(dot(n, L1), 0.0);
    float d2 = max(dot(n, L2), 0.0) * 0.4;
    float sp = pow(max(dot(V, reflect(-L1, n)), 0.0), 12.0) * 0.06;
    vec3 col = uColor * (0.25 + d1 * 0.75 + d2) + vec3(sp) + uEmissive;
    vec4 cp = projectionMatrix * vec4(hit, 1.0);
    gl_FragDepth = cp.z / cp.w * 0.5 + 0.5;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), uOpacity);
  }
`;

export const TORUS_VERTEX_SHADER = `
  uniform float uMajor;
  uniform float uMinor;
  varying vec3 vViewPos;
  varying vec3 vTorusCenter;
  varying vec3 vTorusNormal;
  varying float vTorusR;
  varying float vTorusr;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos     = mvPos.xyz;
    vTorusCenter = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vTorusNormal = normalize(modelViewMatrix[1].xyz);
    float scale  = length(modelViewMatrix[0].xyz);
    vTorusR = uMajor * scale;
    vTorusr = uMinor * scale;
    gl_Position = projectionMatrix * mvPos;
  }
`;

export const TORUS_FRAGMENT_SHADER = `
  uniform mat4 projectionMatrix;
  uniform vec3 uColor;
  uniform vec3 uEmissive;
  uniform float uOpacity;
  uniform vec3 uClipNormal;
  uniform float uClipConstant;
  uniform float uClipEnabled;
  varying vec3 vViewPos;
  varying vec3 vTorusCenter;
  varying vec3 vTorusNormal;
  varying float vTorusR;
  varying float vTorusr;
  bool clipped(vec3 p) {
    return uClipEnabled > 0.5 && dot(p, uClipNormal) + uClipConstant < 0.0;
  }
  float sdTorus(vec3 p) {
    vec3 q = p - vTorusCenter;
    float axial  = dot(q, vTorusNormal);
    float radial = length(q - axial * vTorusNormal);
    return length(vec2(radial - vTorusR, axial)) - vTorusr;
  }
  void main() {
    vec3 rd = normalize(vViewPos);
    float t  = max(0.01, length(vTorusCenter) - vTorusR - vTorusr - 0.2);
    bool hit = false;
    for (int i = 0; i < 160; i++) {
      vec3 p = rd * t;
      float d = sdTorus(p);
      if (d < 0.0002 * t) {
        // Surface reached — accept it unless it's on the clipped side, in which
        // case step forward to the next (interior) surface past the cut.
        if (!clipped(p)) { hit = true; break; }
        t += 0.02;
        continue;
      }
      if (t > 60.0) break;
      t += max(d, 0.001);
    }
    if (!hit) discard;
    vec3 hitPos = rd * t;
    const float eps = 0.002;
    vec3 n = normalize(vec3(
      sdTorus(hitPos + vec3(eps,0.0,0.0)) - sdTorus(hitPos - vec3(eps,0.0,0.0)),
      sdTorus(hitPos + vec3(0.0,eps,0.0)) - sdTorus(hitPos - vec3(0.0,eps,0.0)),
      sdTorus(hitPos + vec3(0.0,0.0,eps)) - sdTorus(hitPos - vec3(0.0,0.0,eps))
    ));
    vec3 L1 = normalize(vec3(10.0, 15.0, 10.0));
    vec3 L2 = normalize(vec3(-10.0, 10.0, -10.0));
    vec3 V  = normalize(-hitPos);
    float d1 = max(dot(n, L1), 0.0);
    float d2 = max(dot(n, L2), 0.0) * 0.4;
    float sp = pow(max(dot(V, reflect(-L1, n)), 0.0), 12.0) * 0.06;
    vec3 col = uColor * (0.25 + d1 * 0.75 + d2) + vec3(sp) + uEmissive;
    vec4 cp = projectionMatrix * vec4(hitPos, 1.0);
    gl_FragDepth = cp.z / cp.w * 0.5 + 0.5;
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), uOpacity);
  }
`;

// The material props an item should render with.  Mirror / circular /
// rectangular pattern clones (kind:"pattern3d") track their originating object,
// so they inherit ITS material live — a later change to the source's material
// flows to every clone on the next scene build.  Everything else uses its own
// item.material (or the default).
export function resolveItemMaterial(item, items, defaultMaterial) {
  const r = item?.regenerator;
  if (r?.kind === "pattern3d" && r.sourceId != null) {
    const src = (items || []).find((i) => i.id === r.sourceId);
    if (src) return src.material ?? defaultMaterial;
  }
  return item?.material ?? defaultMaterial;
}

// `materialProps` is an item.material-shaped object (see
// materialPresets.js#DEFAULT_MATERIAL): { color, metalness, roughness,
// opacity, clearcoat, clearcoatRoughness }. `color` here is the resolved
// THREE color (DEFAULT_MESH_COLOR fallback for items with no recorded
// original), kept separate from materialProps.color for that reason.
export function createMaterial(item, color, materialProps = DEFAULT_MATERIAL) {
  const opacity = materialProps.opacity ?? 1;
  const transparent = opacity < 1;
  const uniforms = () => ({
    uColor: { value: new THREE.Color(color) },
    uEmissive: { value: new THREE.Color(0) },
    uOpacity: { value: opacity },
    // Cross-section clip plane in VIEW space (the analytic shaders compute the
    // surface point in view space, so the plane is supplied there).  Pushed
    // each frame by the animate loop while the cross-section view is active.
    uClipNormal: { value: new THREE.Vector3(0, 0, 0) },
    uClipConstant: { value: 0 },
    uClipEnabled: { value: 0 },
  });
  if (item.type === "sketch") {
    return new THREE.MeshStandardMaterial({
      color: sketchPlaneFillColorFor(useStore.getState().theme),
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }
  if (item.type === "sphere") {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms(), ...primitiveUniforms(item) },
      vertexShader: SPHERE_VERTEX_SHADER,
      fragmentShader: SPHERE_FRAGMENT_SHADER,
      transparent,
    });
  }
  if (item.type === "cylinder") {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms(), ...primitiveUniforms(item) },
      vertexShader: CYLINDER_VERTEX_SHADER,
      fragmentShader: CYLINDER_FRAGMENT_SHADER,
      transparent,
    });
  }
  if (item.type === "torus") {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms(), ...primitiveUniforms(item) },
      vertexShader: TORUS_VERTEX_SHADER,
      fragmentShader: TORUS_FRAGMENT_SHADER,
      transparent,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: materialProps.metalness ?? 0.3,
    roughness: materialProps.roughness ?? 0.5,
    opacity,
    transparent,
    clearcoat: materialProps.clearcoat ?? 0,
    clearcoatRoughness: materialProps.clearcoatRoughness ?? 0,
  });
}

// Live-preview helper: mutate an already-built mesh's material in place to
// match `materialProps` (item.material shape, color as CSS hex string), so
// MaterialDialog can show changes instantly without rebuilding the scene.
// Sketch items are excluded — their translucency is a fixed UI affordance,
// not user-editable material.
export function applyMaterialToMesh(mesh, item, materialProps) {
  if (item.type === "sketch") return;
  const opacity = materialProps.opacity ?? 1;
  const transparent = opacity < 1;
  const mat = mesh.material;
  if (mat.uniforms?.uColor) {
    mat.uniforms.uColor.value.set(materialProps.color ?? DEFAULT_MESH_COLOR);
    mat.uniforms.uOpacity.value = opacity;
    mat.transparent = transparent;
    mat.needsUpdate = true;
    return;
  }
  mat.color.set(materialProps.color ?? DEFAULT_MESH_COLOR);
  if ("metalness" in mat) mat.metalness = materialProps.metalness ?? 0.3;
  if ("roughness" in mat) mat.roughness = materialProps.roughness ?? 0.5;
  if ("clearcoat" in mat) mat.clearcoat = materialProps.clearcoat ?? 0;
  if ("clearcoatRoughness" in mat)
    mat.clearcoatRoughness = materialProps.clearcoatRoughness ?? 0;
  mat.opacity = opacity;
  mat.transparent = transparent;
  mat.depthWrite = !transparent;
  mat.needsUpdate = true;
}

export function updateEmissive(objectsRef, selectedId, selectedIds, hoveredId) {
  Object.entries(objectsRef.current).forEach(([itemId, mesh]) => {
    const id = parseInt(itemId);
    const hex =
      id === selectedId
        ? EMISSIVE_SELECTED
        : selectedIds.includes(id)
          ? EMISSIVE_MULTI_SELECTED
          : id === hoveredId
            ? EMISSIVE_HOVERED
            : NO_EMISSIVE;
    if (mesh.material.uniforms?.uEmissive) {
      mesh.material.uniforms.uEmissive.value.setHex(hex);
    } else if (mesh.material.emissive) {
      mesh.material.emissive.setHex(hex);
      mesh.material.needsUpdate = true;
    }
  });
}

// The sketch plane is a reference surface, not part of the model: keep it hidden
// in the 3D view (the sketch's lines render separately and stay visible) and
// reveal it only while the sketch is hovered in the objects list, or while it is
// the active drawing surface in sketch mode.  Runs on hover changes so the plane
// appears/disappears without a full render-mode pass.
export function updateSketchPlaneVisibility(
  objectsRef,
  itemsRef,
  hoveredId,
  sketchMode,
  activeSketchId,
) {
  Object.values(objectsRef.current).forEach((mesh) => {
    const item = itemsRef.current.find((i) => i.id === mesh.userData.itemId);
    if (!item || item.type !== "sketch") return;
    if (item.visible === false) {
      mesh.visible = false;
      return;
    }
    const isActive = sketchMode && item.id === activeSketchId;
    mesh.visible = isActive || item.id === hoveredId;
  });
}

// While a hidden object is selected, reveal it at 25% opacity (75% transparent)
// so the user can see what they've picked in the objects list; hidden objects
// that aren't selected stay hidden.  applyRenderMode forces hidden meshes
// invisible, so this runs after it (and on selection change) to override.
export function applyHiddenSelectionVisibility(
  objectsRef,
  itemsRef,
  selectedIds,
) {
  const sel = new Set(selectedIds || []);
  Object.values(objectsRef.current).forEach((mesh) => {
    const item = itemsRef.current.find((i) => i.id === mesh.userData.itemId);
    if (!item || item.visible !== false || item.type === "sketch") return;
    const selected = sel.has(item.id);
    mesh.visible = selected;
    if (!selected) return;
    const m = mesh.material;
    if (!m) return;
    if (m.uniforms?.uOpacity) {
      m.uniforms.uOpacity.value = 0.25;
      m.transparent = true;
      m.depthWrite = false;
    } else if ("opacity" in m) {
      m.transparent = true;
      m.opacity = 0.25;
      m.depthWrite = false;
      m.needsUpdate = true;
    }
  });
}

// Final visibility pass.  When an item is soloed, show ONLY its mesh (even if
// the item is marked hidden) and hide everything else; otherwise fall back to
// the normal hidden/selected reveal.  Guards against a stale solo id (the soloed
// item was deleted / the timeline moved) leaving the scene entirely blank.
export function finalizeVisibility(objectsRef, itemsRef, selectedIds, soloId) {
  if (soloId != null) {
    const meshes = Object.values(objectsRef.current);
    const hasSolo = meshes.some((m) => m.userData.itemId === soloId);
    if (hasSolo) {
      meshes.forEach((mesh) => {
        mesh.visible = mesh.userData.itemId === soloId;
      });
      return;
    }
  }
  applyHiddenSelectionVisibility(objectsRef, itemsRef, selectedIds);
}
