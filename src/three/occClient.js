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

const isElectron = typeof window !== "undefined" && window.electronAPI != null;

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
    return window.electronAPI.invokeOcc(op, args);
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

export function performCsg(args) {
  return runOp("performCsg", args);
}

export function exportSTL(args) {
  return runOp("exportSTL", args);
}

export function exportSTEP(args) {
  return runOp("exportSTEP", args);
}
