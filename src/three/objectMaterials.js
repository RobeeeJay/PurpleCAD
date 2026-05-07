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

export const CYLINDER_VERTEX_SHADER = `
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
    vCylRadius = length(modelViewMatrix[0].xyz);
    vCylHalfH  = length(modelViewMatrix[1].xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

export const CYLINDER_FRAGMENT_SHADER = `
  uniform mat4 projectionMatrix;
  uniform vec3 uColor;
  uniform vec3 uEmissive;
  varying vec3 vViewPos;
  varying vec3 vCylCenter;
  varying vec3 vCylAxis;
  varying float vCylRadius;
  varying float vCylHalfH;
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
    float tHit = -1.0;
    vec3 nHit  = vec3(0.0);
    if (abs(A) > 1e-6) {
      float disc = B*B - 4.0*A*C;
      if (disc >= 0.0) {
        float sq = sqrt(disc);
        float t1 = (-B - sq) / (2.0*A);
        float t2 = (-B + sq) / (2.0*A);
        if (t1 > 0.001) {
          float y1 = dot(rd*t1 - sc, a);
          if (abs(y1) <= h) { tHit = t1; nHit = normalize((rd*t1 - sc) - y1*a); }
        }
        if (tHit < 0.0 && t2 > 0.001) {
          float y2 = dot(rd*t2 - sc, a);
          if (abs(y2) <= h) { tHit = t2; nHit = normalize((rd*t2 - sc) - y2*a); }
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
          if (dot(radial, radial) <= r*r) { tHit = tCap; nHit = capSign * a; }
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
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

export const TORUS_VERTEX_SHADER = `
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
    vTorusR = 1.0 * scale;
    vTorusr = 0.4 * scale;
    gl_Position = projectionMatrix * mvPos;
  }
`;

export const TORUS_FRAGMENT_SHADER = `
  uniform mat4 projectionMatrix;
  uniform vec3 uColor;
  uniform vec3 uEmissive;
  varying vec3 vViewPos;
  varying vec3 vTorusCenter;
  varying vec3 vTorusNormal;
  varying float vTorusR;
  varying float vTorusr;
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
    for (int i = 0; i < 128; i++) {
      float d = sdTorus(rd * t);
      if (d < 0.0002 * t) { hit = true; break; }
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
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

export function createMaterial(item, color) {
  const uniforms = () => ({
    uColor: { value: new THREE.Color(color) },
    uEmissive: { value: new THREE.Color(0) },
  });
  if (item.type === "sketch") {
    return new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }
  if (item.type === "sphere") {
    return new THREE.ShaderMaterial({
      uniforms: uniforms(),
      vertexShader: SPHERE_VERTEX_SHADER,
      fragmentShader: SPHERE_FRAGMENT_SHADER,
    });
  }
  if (item.type === "cylinder") {
    return new THREE.ShaderMaterial({
      uniforms: uniforms(),
      vertexShader: CYLINDER_VERTEX_SHADER,
      fragmentShader: CYLINDER_FRAGMENT_SHADER,
    });
  }
  if (item.type === "torus") {
    return new THREE.ShaderMaterial({
      uniforms: uniforms(),
      vertexShader: TORUS_VERTEX_SHADER,
      fragmentShader: TORUS_FRAGMENT_SHADER,
    });
  }
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.3,
    roughness: 0.5,
  });
}

export function updateEmissive(objectsRef, selectedId, selectedIds, hoveredId) {
  Object.entries(objectsRef.current).forEach(([itemId, mesh]) => {
    const id = parseInt(itemId);
    const hex =
      id === selectedId
        ? 0x006666
        : selectedIds.includes(id)
          ? 0x550011
          : id === hoveredId
            ? 0x444444
            : 0x000000;
    if (mesh.material.uniforms?.uEmissive) {
      mesh.material.uniforms.uEmissive.value.setHex(hex);
    } else if (mesh.material.emissive) {
      mesh.material.emissive.setHex(hex);
      mesh.material.needsUpdate = true;
    }
  });
}
