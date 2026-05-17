// OpenCascade.js singleton initializer.
//
// Works in both browser (Vite handles the .wasm import) and Node (vitest
// can't resolve the .wasm import opencascade.js does, so we read the
// WASM with `fs` and pass it as `wasmBinary`).

let ocPromise = null;
let oc = null;

async function initInNode() {
  const fs = await import("fs");
  const pathMod = await import("path");
  const url = await import("url");
  const ocFactory = (
    await import("opencascade.js/dist/opencascade.wasm.js")
  ).default;
  // Resolve the .wasm relative to the opencascade.js package on disk.
  const ocJsUrl = await import.meta.resolve(
    "opencascade.js/dist/opencascade.wasm.wasm",
  );
  const ocWasmPath = url.fileURLToPath(ocJsUrl);
  void pathMod;
  const wasmBinary = fs.readFileSync(ocWasmPath);
  return ocFactory({ wasmBinary });
}

async function initInBrowser() {
  const { initOpenCascade } = await import("opencascade.js");
  return initOpenCascade();
}

export function ensureOcc() {
  if (ocPromise) return ocPromise;
  const isNode =
    typeof process !== "undefined" &&
    process.versions &&
    typeof process.versions.node === "string";
  ocPromise = (isNode ? initInNode() : initInBrowser()).then((instance) => {
    oc = instance;
    return instance;
  });
  return ocPromise;
}

export function getOcc() {
  if (!oc) {
    throw new Error(
      "OpenCascade not initialized — call ensureOcc() and await it first.",
    );
  }
  return oc;
}

export function isOccReady() {
  return oc !== null;
}
