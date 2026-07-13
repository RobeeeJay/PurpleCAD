// PNG → heightfield for the Texture tool.  Renderer-only (Image + canvas);
// vitest injects a decoder via setHeightfieldDecoder, and the displacement
// core (textureDisplace.js) only ever sees the plain heightfield object.

let decoder = null;
export function setHeightfieldDecoder(fn) {
  decoder = fn;
}

// dataURL → { width, height, data: Float32Array } (luminance 0..1, white=1).
// Cached per dataURL: the same texture is re-decoded on every preview
// keystroke and every timeline regen otherwise.
const cache = new Map();
export async function decodeHeightfield(dataURL) {
  if (!dataURL) return null;
  const hit = cache.get(dataURL);
  if (hit) return hit;
  const promise = (decoder || defaultDecode)(dataURL).catch((err) => {
    cache.delete(dataURL); // a failed decode must not poison the cache
    throw err;
  });
  cache.set(dataURL, promise);
  return promise;
}

function defaultDecode(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const out = new Float32Array(canvas.width * canvas.height);
      for (let i = 0; i < out.length; i++) {
        const o = i * 4;
        // Rec. 601 luminance, alpha-weighted so transparent = no displacement.
        out[i] =
          ((0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) /
            255) *
          (data[o + 3] / 255);
      }
      resolve({ width: canvas.width, height: canvas.height, data: out });
    };
    img.onerror = () => reject(new Error("Could not decode the image."));
    img.src = dataURL;
  });
}
