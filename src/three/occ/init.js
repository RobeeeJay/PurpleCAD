// Native addon requires no async init — stub API for backward compat.
export async function ensureOcc() {}
export function isOccReady() {
  return true;
}
export function getOcc() {
  throw new Error(
    "getOcc() is not available — opencascade.js has been replaced by the native C++ addon.",
  );
}
