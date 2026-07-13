// Web Worker body for the Texture tool's displacement: refine + displace can
// take seconds at fine resolutions, and on the main thread that freezes every
// interaction.  The math lives in textureDisplace.js (pure arrays, no DOM /
// THREE), so it runs here unchanged.

import { displaceMesh } from "./textureDisplace.js";

self.onmessage = (e) => {
  const { id, args } = e.data;
  try {
    const result = displaceMesh(args);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err?.message || "Texture failed." });
  }
};
