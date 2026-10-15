// Carries OCC op arguments and results between the web view and the OCC
// thread.  WebKit's message bridge passes plain JSON-like values only, and an
// op's meshes are typed arrays, which Electron's structured clone delivers
// intact -- so each typed array travels as { __typed, b64 } and comes back as
// the same type.  Loaded into both the page and the OCC JavaScriptCore
// context, which has no atob/btoa, hence the hand-rolled base64.
(function (g) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const R = new Uint8Array(128);
  for (let i = 0; i < 64; i++) R[A.charCodeAt(i)] = i;
  const TYPES = {
    Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
    Int32Array, Uint32Array, Float32Array, Float64Array,
  };

  function toB64(u8) {
    const parts = [];
    let out = "";
    let i = 0;
    for (; i + 2 < u8.length; i += 3) {
      const n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
      out += A[n >> 18] + A[(n >> 12) & 63] + A[(n >> 6) & 63] + A[n & 63];
      if (out.length >= 32768) {
        parts.push(out);
        out = "";
      }
    }
    const rest = u8.length - i;
    if (rest === 1) {
      const n = u8[i] << 16;
      out += A[n >> 18] + A[(n >> 12) & 63] + "==";
    } else if (rest === 2) {
      const n = (u8[i] << 16) | (u8[i + 1] << 8);
      out += A[n >> 18] + A[(n >> 12) & 63] + A[(n >> 6) & 63] + "=";
    }
    parts.push(out);
    return parts.join("");
  }

  function fromB64(s) {
    const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
    const out = new Uint8Array((s.length / 4) * 3 - pad);
    let o = 0;
    for (let i = 0; i < s.length; i += 4) {
      const n =
        (R[s.charCodeAt(i)] << 18) |
        (R[s.charCodeAt(i + 1)] << 12) |
        (R[s.charCodeAt(i + 2)] << 6) |
        R[s.charCodeAt(i + 3)];
      out[o++] = n >> 16;
      if (o < out.length) out[o++] = (n >> 8) & 255;
      if (o < out.length) out[o++] = n & 255;
    }
    return out;
  }

  function encode(value) {
    const s = JSON.stringify(value, (_k, v) =>
      ArrayBuffer.isView(v) && !(v instanceof DataView)
        ? {
            __typed: TYPES[v.constructor.name] ? v.constructor.name : "Uint8Array",
            b64: toB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)),
          }
        : v,
    );
    return s === undefined ? "null" : s;
  }

  function decode(text) {
    return JSON.parse(text, (_k, v) => {
      if (v && typeof v === "object" && typeof v.__typed === "string") {
        const Type = TYPES[v.__typed];
        if (!Type) throw new Error(`codec: unknown typed array ${v.__typed}`);
        return new Type(fromB64(v.b64).buffer);
      }
      return v;
    });
  }

  g.PurpleCodec = { encode, decode };
})(globalThis);
