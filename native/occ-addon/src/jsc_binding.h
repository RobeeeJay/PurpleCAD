// JavaScriptCore adapter: the iPad host for the OCC ops (occ_js.h).  Plain C,
// so the iPad app's Swift can import it through its bridging header.
#pragma once

#include <JavaScriptCore/JavaScriptCore.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// An object carrying the same functions as the N-API module, for a script
// in `ctx` (occ-bridge.cjs requires it as the addon).  Runs the process-wide
// setup on the calling thread, which must be the thread that runs the ops.
JSObjectRef OccMakeAddon(JSContextRef ctx);

// The int32 a native host sets non-zero (from any thread) to abort the op
// running now; the host clears it before the next op.  Plays the part of the
// SharedArrayBuffer the Electron worker passes to setCancelBuffer.
void OccSetCancelFlag(volatile int32_t* flag);

#ifdef __cplusplus
}
#endif
