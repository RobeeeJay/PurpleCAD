// The iPad host carries every OCC op's arguments and result through WebKit's
// message bridge, which passes JSON-like values only (ios/app/PurpleCAD/js/
// codec.js).  Electron's structured clone delivers typed arrays intact, and
// the renderer relies on getting a Float32Array back, not an object of
// indices -- so the codec has to round-trip them exactly.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const g = {};
new Function(
  "globalThis",
  readFileSync(
    resolve(__dirname, "../../../../ios/app/PurpleCAD/js/codec.js"),
    "utf8",
  ),
)(g);
const { encode, decode } = g.PurpleCodec;
const roundTrip = (v) => decode(encode(v));

describe("iPad OCC message codec", () => {
  it("returns every typed array as the same type with the same bits", () => {
    const f32 = new Float32Array([1.5, -0, NaN, 3.4e38, 1e-45]);
    const value = {
      positions: f32,
      indices: new Uint32Array([0, 1, 2, 4294967295]),
      f64: new Float64Array([Math.PI, -1e308]),
      i32: new Int32Array([-2147483648, 7]),
      bytes: new Uint8Array([0, 255, 128]),
    };
    const back = roundTrip(value);
    for (const [k, v] of Object.entries(value)) {
      expect(back[k].constructor.name, k).toBe(v.constructor.name);
      expect(Buffer.from(back[k].buffer).equals(Buffer.from(v.buffer)), k).toBe(
        true,
      );
    }
  });

  it("sends only a subarray's own elements, at any length", () => {
    // Every remainder of the base64 tail: 0, 1 and 2 leftover bytes.
    for (let n = 0; n < 8; n++) {
      const big = new Uint8Array(20).map((_, i) => i * 7);
      const view = big.subarray(3, 3 + n);
      const back = roundTrip({ view }).view;
      expect(Array.from(back), `length ${n}`).toEqual(Array.from(view));
    }
  });

  it("leaves plain values alone and survives an undefined result", () => {
    const plain = { a: 1, b: "x", c: [1, { d: null }], e: true };
    expect(roundTrip(plain)).toEqual(plain);
    expect(roundTrip(undefined)).toBeNull();
    expect(roundTrip(null)).toBeNull();
  });

  it("refuses a typed array tag it does not know", () => {
    expect(() => decode('{"x":{"__typed":"Evil","b64":""}}')).toThrow(
      /unknown typed array/,
    );
  });
});
