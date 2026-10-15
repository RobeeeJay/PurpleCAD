// Runs in the OCC thread's JavaScriptCore context, after codec.js: loads the
// unchanged electron/occ-bridge.cjs and exposes __invoke(op, payload) for
// OccHost.swift, which plays the part of the Electron OCC worker.
//
// The bridge needs only require("path") and the addon (OccMakeAddon's object,
// installed by Swift as __occ), plus Node's Buffer for exportSTL; these are
// the few pieces of Node it touches.
(function (g) {
  const path = {
    join: (...parts) => parts.join("/"),
    dirname: (p) => p.replace(/\/[^/]*$/, "") || "/",
  };
  function require(p) {
    if (p === "path") return path;
    if (p.endsWith("occ_addon.node")) return g.__occ;
    throw new Error(`occ-host: cannot require ${p}`);
  }

  // exportSTL writes into Buffer.allocUnsafe(n) with the little-endian
  // writers below and returns it; a Uint8Array carrying them is enough, and
  // it crosses back to the page as a Uint8Array, as Electron delivers it.
  g.Buffer = {
    allocUnsafe(n) {
      const b = new Uint8Array(n);
      const dv = new DataView(b.buffer);
      b.writeUInt32LE = (v, o) => (dv.setUint32(o, v, true), o + 4);
      b.writeUInt16LE = (v, o) => (dv.setUint16(o, v, true), o + 2);
      b.writeFloatLE = (v, o) => (dv.setFloat32(o, v, true), o + 4);
      return b;
    },
  };

  const module = { exports: {} };
  new Function("module", "exports", "require", "__dirname", "__filename",
               g.__bridgeSource)(module, module.exports, require, "/occ",
                                 "/occ/occ-bridge.cjs");
  const bridge = module.exports;

  g.__invoke = (op, payload) => {
    const fn = bridge[op];
    if (typeof fn !== "function") throw new Error(`unknown OCC op: ${op}`);
    return g.PurpleCodec.encode(fn(g.PurpleCodec.decode(payload)));
  };
})(globalThis);
