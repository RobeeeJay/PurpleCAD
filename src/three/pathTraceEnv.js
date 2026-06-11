// Procedural "studio" lighting environment for the path tracer.
//
// three-gpu-pathtracer importance-samples scene.environment, which means it
// needs an equirect texture with real pixel data (a PMREM-processed texture
// has none — see the EquirectHdrInfoUniform shim note in pathTrace.js).
// ProceduralEquirectTexture generates that data from a callback, so we build
// a sky/ground gradient plus a three-point softbox rig (key, fill, rim) with
// HDR intensities (>1) — giving metals/glass something believable to reflect
// without fetching an external HDR asset.

import * as THREE from "three";
import { ProceduralEquirectTexture } from "three-gpu-pathtracer";

const SKY_COLOR = new THREE.Color(0xbfd4ff);
const GROUND_COLOR = new THREE.Color(0x2a2a30);

const LIGHTS = [
  // key: bright, upper front-right
  {
    dir: new THREE.Vector3(0.5, 0.75, 0.6).normalize(),
    color: new THREE.Color(0xfff4e0),
    angle: 0.55,
    intensity: 6,
  },
  // fill: dim, upper-left
  {
    dir: new THREE.Vector3(-0.6, 0.4, 0.3).normalize(),
    color: new THREE.Color(0xcfe0ff),
    angle: 0.7,
    intensity: 1.5,
  },
  // rim: from behind, picks out edges
  {
    dir: new THREE.Vector3(0.1, 0.3, -0.95).normalize(),
    color: new THREE.Color(0xffffff),
    angle: 0.35,
    intensity: 4,
  },
];

const _dir = new THREE.Vector3();

// Smooth falloff from 1 (at the light's center direction) to 0 at `angle`
// radians away — a soft-edged "softbox" disc rather than a hard spotlight.
const softboxFalloff = (cosAngleToLight, angle) => {
  const angleTo = Math.acos(THREE.MathUtils.clamp(cosAngleToLight, -1, 1));
  const t = THREE.MathUtils.clamp(angleTo / angle, 0, 1);
  return 1 - t * t * (3 - 2 * t);
};

export function buildStudioEnvTexture(resolution = 512) {
  const tex = new ProceduralEquirectTexture(resolution, resolution);
  tex.generationCallback = (polar, uv, coord, color) => {
    _dir.setFromSpherical(polar);

    const t = _dir.y * 0.5 + 0.5;
    color.lerpColors(GROUND_COLOR, SKY_COLOR, t ** 1.5);

    for (const light of LIGHTS) {
      const falloff = softboxFalloff(_dir.dot(light.dir), light.angle);
      if (falloff <= 0) continue;
      color.r += light.color.r * light.intensity * falloff;
      color.g += light.color.g * light.intensity * falloff;
      color.b += light.color.b * light.intensity * falloff;
    }
  };
  tex.update();
  return tex;
}
