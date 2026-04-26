import * as THREE from "three";

export const SPHERE_VERTEX_SHADER = `
  varying vec3 vViewPos;
  varying vec3 vSphereCenter;
  varying float vSphereRadius;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mvPos.xyz;
    vSphereCenter = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vSphereRadius = 1.5 * length(modelViewMatrix[0].xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

export const SPHERE_FRAGMENT_SHADER = `
  uniform mat4 projectionMatrix;
  uniform vec3 uColor;
  uniform vec3 uEmissive;
  varying vec3 vViewPos;
  varying vec3 vSphereCenter;
  varying float vSphereRadius;
  void main() {
    vec3 sc = vSphereCenter;
    float sr = vSphereRadius;
    vec3 rd = normalize(vViewPos);
    float b = dot(rd, sc);
    float c = dot(sc, sc) - sr * sr;
    float disc = b * b - c;
    if (disc < 0.0) discard;
    float t = b - sqrt(disc);
    if (t < 0.0) t = b + sqrt(disc);
    if (t < 0.0) discard;
    vec3 hit = rd * t;
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
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

export function createMaterial(item, color) {
  if (item.type === "sketch") {
    return new THREE.MeshStandardMaterial({
      color: 0x88aaff,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }
  if (item.type === "sphere") {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor:    { value: new THREE.Color(color) },
        uEmissive: { value: new THREE.Color(0) },
      },
      vertexShader: SPHERE_VERTEX_SHADER,
      fragmentShader: SPHERE_FRAGMENT_SHADER,
    });
  }
  return new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.5 });
}

export function updateEmissive(objectsRef, selectedId, selectedIds, hoveredId) {
  Object.entries(objectsRef.current).forEach(([itemId, mesh]) => {
    const id = parseInt(itemId);
    const hex = id === selectedId ? 0x006666
      : selectedIds.includes(id) ? 0x550011
      : id === hoveredId ? 0x444444
      : 0x000000;
    if (mesh.material.uniforms?.uEmissive) {
      mesh.material.uniforms.uEmissive.value.setHex(hex);
    } else if (mesh.material.emissive) {
      mesh.material.emissive.setHex(hex);
      mesh.material.needsUpdate = true;
    }
  });
}
