// occClient — async, promise-based RPC layer around the OCC operations.
//
// Two execution paths, selected at runtime:
//
//  1. Electron renderer  — calls `window.electronAPI.invokeOcc(op, args)`
//     which routes through IPC to the native C++ addon in the main process.
//
//  2. Node / vitest — in-process native addon via dynamic import of occOps.js.
//     Only reached when window.electronAPI is absent and Worker is unavailable.
//
// Inputs/outputs are always plain JS so no special marshalling is needed.

import { useStore } from "../store";
import { resolveValue } from "./geometryParams.js";
import { variablesToMap } from "../utils/formulas.js";
import { withLivePolygons } from "./csgUtils.js";

const isElectron = typeof window !== "undefined" && window.electronAPI != null;

// The Electron main-process bridge can't evaluate variable formulas (it has no
// store), so an extrude depth like "height" parses to NaN there and falls back
// to 1 unit (10 mm).  Resolve every extrude depth to a concrete scene-unit
// number here — where the store and the formula evaluator live — before the
// args cross the IPC boundary, so the bridge only ever sees numbers.
export function deepResolveDepth(item, varsMap) {
  if (!item || typeof item !== "object") return item;
  let out = item;
  if (item.type === "extrude" && typeof item.depth === "string") {
    out = { ...item, depth: resolveValue(item.depth, 1.0, varsMap) };
  }
  const r = out.regenerator;
  if (r?.source) {
    const src = deepResolveDepth(r.source, varsMap);
    if (src !== r.source) out = { ...out, regenerator: { ...r, source: src } };
  }
  // A fused extrude (extrudeUnion / extrudeCut) carries its prism recipes in
  // regenerator.extrudeDefs — each an extrude with a possibly-formula depth.
  // When such an item is a HOST/nested input the bridge rebuilds it from these
  // defs, so they must be resolved too; otherwise "Height-WallThickness" reaches
  // the bridge as NaN and the whole body collapses to the 1-unit fallback.
  const rd = out.regenerator;
  if (Array.isArray(rd?.extrudeDefs)) {
    const defs = rd.extrudeDefs.map((d) => deepResolveDepth(d, varsMap));
    if (defs.some((d, i) => d !== rd.extrudeDefs[i]))
      out = { ...out, regenerator: { ...rd, extrudeDefs: defs } };
  }
  return out;
}

function resolveArgDepths(args) {
  if (!args || typeof args !== "object") return args;
  const varsMap = variablesToMap(useStore.getState().variables);
  const mapArr = (arr) =>
    Array.isArray(arr) ? arr.map((i) => deepResolveDepth(i, varsMap)) : arr;
  const out = { ...args };
  if (args.source) out.source = deepResolveDepth(args.source, varsMap);
  if (args.allItems) out.allItems = mapArr(args.allItems);
  if (args.selectedItems) out.selectedItems = mapArr(args.selectedItems);
  if (args.items) out.items = mapArr(args.items);
  return out;
}

// The Electron bridge can't re-derive an extrude's profile from its sketch (it
// can't import the ESM geometry helpers), so it builds from each item's STORED
// polygon2D.  That polygon goes stale whenever the source sketch is edited
// after the extrude was created — the renderer re-derives it live, but a raw
// item handed straight to performCsg (e.g. an extrude used as a boss HOST in
// runExtrudeUnion) reaches the bridge with the frozen polygon and rebuilds at
// the OLD profile, so the host "extrudes for no reason".  Pre-bake the live
// polygon into every item here, mirroring resolveArgDepths — the same reason
// depths are resolved before the boundary.  occOps (the vitest path) re-derives
// internally, so this is only needed for the bridge, but applying it on both
// paths is harmless and keeps the two in lockstep.
export function bakeArgPolygons(args) {
  if (!args || typeof args !== "object") return args;
  const allItems = Array.isArray(args.allItems) ? args.allItems : [];
  const precision = args.printPrecision ?? null;
  const bake = (i) => withLivePolygons(i, allItems, precision);
  const mapArr = (arr) => (Array.isArray(arr) ? arr.map(bake) : arr);
  const out = { ...args };
  if (args.source) out.source = bake(args.source);
  if (args.allItems) out.allItems = mapArr(args.allItems);
  if (args.selectedItems) out.selectedItems = mapArr(args.selectedItems);
  if (args.items) out.items = mapArr(args.items);
  return out;
}

let inProcessOps = null;
async function getInProcessOps() {
  if (!inProcessOps) {
    const mod = await import(/* @vite-ignore */ "./occOps.js");
    inProcessOps = mod.ops;
  }
  return inProcessOps;
}

function inc() {
  const s = useStore.getState();
  if (typeof s.beginOperation === "function") s.beginOperation();
}
function dec() {
  const s = useStore.getState();
  if (typeof s.endOperation === "function") s.endOperation();
}

const now = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

// Wall-clock HH:MM:SS.mmm for the debug logs.
const clock = () => {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

// OCC calls are SERIALISED. Two ops must never be in flight at once: they
// share the native shape store and the item-keyed solid cache, and the
// preview-supersede path (inputs.jsx) calls cancelOcc + clearSolids, which
// releases cached shapes out from under whatever else is running. A live
// preview that outlives its debounce therefore used to pull the source shape
// away from the COMMIT that followed it, and the commit came back with an
// empty mesh -- no error, the item still recorded. It only showed up on ops
// slow enough to still be running at Confirm: a threaded M3 hole at 8mm did
// it every time, the same hole at 4mm never did.
let opChain = Promise.resolve();

async function callOp(op, args) {
  const run = opChain.then(
    () => invokeOp(op, args),
    () => invokeOp(op, args),
  );
  // Keep the chain alive regardless of this call's outcome.
  opChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

export const ipcErrorMessage = (message) =>
  String(message ?? "").replace(
    /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/,
    "",
  );

async function invokeOp(op, args) {
  // Debug timing: log every OCC op's start + end wall-clock time + duration
  // (round-trip, including IPC to the worker).  Grep the console for "[OCC]".
  const t0 = now();
  /* eslint-disable no-console */
  console.log(`[OCC] ${op} start ${clock()}`);
  try {
    const result = isElectron
      ? await window.electronAPI.invokeOcc(
          op,
          resolveArgDepths(bakeArgPolygons(args)),
        )
      : await (async () => {
          const ops = await getInProcessOps();
          const fn = ops[op];
          if (typeof fn !== "function") throw new Error(`Unknown op "${op}"`);
          return fn(args);
        })();
    console.log(`[OCC] ${op} end ${clock()} (${(now() - t0).toFixed(1)}ms)`);
    return result;
  } catch (e) {
    console.log(
      `[OCC] ${op} FAILED ${clock()} (${(now() - t0).toFixed(1)}ms): ${e.message}`,
    );
    // Electron wraps a worker error as "Error invoking remote method
    // 'occ:<op>': Error: <message>" -- the user needs only the message.
    const clean = ipcErrorMessage(e.message);
    if (clean !== e.message) throw new Error(clean);
    throw e;
  }
  /* eslint-enable no-console */
}

async function runOp(op, args) {
  inc();
  // Cancel has two layers: the worker's native op aborts via the shared cancel
  // flag (cancelOcc, frees the CPU), and this soft layer discards any result
  // that still lands (an op that finished before the flag was seen, or a
  // non-abortable op) so a stale result never reaches the UI.
  const epoch = useStore.getState().cancelEpoch;
  const cancelled = () => useStore.getState().cancelEpoch !== epoch;
  try {
    await new Promise((r) => setTimeout(r, 0));
    if (cancelled()) {
      // eslint-disable-next-line no-console
      console.log(`[OCC] ${op} CANCELLED before start (skipped)`);
      return null;
    }
    const result = await callOp(op, args);
    if (cancelled()) {
      // eslint-disable-next-line no-console
      console.log(
        `[OCC] ${op} CANCELLED after completion (result discarded; op still ran)`,
      );
      return null;
    }
    return result;
  } finally {
    dec();
  }
}

// Release a cached OCC solid (JIT-timeline solid cache).  Lightweight cleanup:
// bypasses the busy-counter / cancel machinery of runOp — it must always run,
// even mid-cancel, and shouldn't flash the spinner.
export function releaseShape(id) {
  if (id == null) return Promise.resolve(null);
  return callOp("releaseShape", { id });
}

// Sew a baked mesh into a retained solid (JIT cache input fallback).  Direct
// route (no busy/cancel wrapper) — it runs inside the recalc loop.
export function tessellateItem(args) {
  return runOp("tessellateItem", args);
}

export function solidFromMesh(geometryData) {
  return callOp("solidFromMesh", geometryData);
}

// Weld a mesh by exact position and report its open / non-manifold edges.
// Direct route, like solidFromMesh: it runs on import and while a document
// loads, and must not be discarded by a cancel aimed at some other op.
export function weldMesh(geometryData) {
  return callOp("weldMesh", geometryData);
}

// Genuine cancel: ask the main process to flip the shared cancel flag, so the
// worker's in-flight native OCC op aborts (UserBreak) and frees the CPU — no
// process/worker kill, so nothing shared is corrupted.  Electron-only; a no-op
// elsewhere.  The op still rejects/returns null via the soft-cancel epoch, and
// the caller clears the solid cache (a half-built shape was never stored).
// A COMMIT must not be abortable by a preview supersede. Cancel is a shared
// native flag: the worker clears it between ops, so a cancel fired while an op
// is RUNNING aborts that op wherever it has got to -- and an abort during
// meshing returns an EMPTY tessellation rather than throwing. A tool's live
// preview debounce fires cancelOcc whenever something is in flight, so a
// commit slower than the debounce got shot in the back by its own preview and
// wrote an empty body, with no error and the timeline step still recorded.
// Measured: a threaded M3 hole at 8mm (~450ms) hit this every time, the same
// hole at 4mm (~200ms) never did.
let commitDepth = 0;

export async function withCommitGuard(fn) {
  commitDepth += 1;
  try {
    return await fn();
  } finally {
    commitDepth -= 1;
  }
}

export function cancelOcc() {
  if (!isElectron) return Promise.resolve(null);
  if (commitDepth > 0) {
    // eslint-disable-next-line no-console
    console.log("[OCC] cancel suppressed — a commit is in flight");
    return Promise.resolve(null);
  }
  // eslint-disable-next-line no-console
  console.log("[OCC] requesting cancel (worker abort)");
  return window.electronAPI.invokeOcc("cancel");
}

export function chamferOrFilletItem(args) {
  return runOp("chamferOrFilletItem", args);
}

export function pushPullFaces(args) {
  return runOp("pushPullFaces", args);
}

export function shellItem(args) {
  return runOp("shellItem", args);
}

// Simplify a mesh body's triangles, held to a measured deviation or a triangle
// count (occOps.js#simplifyMesh).
export function simplifyMesh(args) {
  return runOp("simplifyMesh", args);
}

export function holeItem(args) {
  return runOp("holeItem", args);
}

export function embossItem(args) {
  return runOp("embossItem", args);
}

export function draftItem(args) {
  return runOp("draftItem", args);
}

export function revolveItem(args) {
  return runOp("revolveItem", args);
}

export function pipeItem(args) {
  return runOp("pipeItem", args);
}

export function loftItem(args) {
  return runOp("loftItem", args);
}

export function performCsg(args) {
  return runOp("performCsg", args);
}

export function exportSTL(args) {
  return runOp("exportSTL", args);
}

export function exportSTEP(args) {
  return runOp("exportSTEP", args);
}

export function importStep(args) {
  return runOp("importStep", args);
}

export function splitItem(args) {
  return runOp("splitItem", args);
}

export function pattern3dItem(args) {
  return runOp("pattern3dItem", args);
}
