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

async function callOp(op, args) {
  if (isElectron) {
    return window.electronAPI.invokeOcc(op, resolveArgDepths(args));
  }
  const ops = await getInProcessOps();
  const fn = ops[op];
  if (typeof fn !== "function") throw new Error(`Unknown op "${op}"`);
  return fn(args);
}

async function runOp(op, args) {
  inc();
  try {
    await new Promise((r) => setTimeout(r, 0));
    return await callOp(op, args);
  } finally {
    dec();
  }
}

export function chamferOrFilletItem(args) {
  return runOp("chamferOrFilletItem", args);
}

export function pushPullFaces(args) {
  return runOp("pushPullFaces", args);
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
