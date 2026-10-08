// JavaScriptCore adapter: the iPad host for the OCC ops (occ_js.h).
#pragma once

#include <JavaScriptCore/JavaScriptCore.h>

// An object carrying the same functions as the N-API module, for a script
// in `ctx` (occ-bridge.cjs requires it as the addon).  Runs the process-wide
// setup on the calling thread, which must be the thread that runs the ops.
JSObjectRef OccMakeAddon(JSContextRef ctx);
