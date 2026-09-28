// Mesh tools built on meshoptimizer (vendored in third_party/meshoptimizer):
// welding, and the edge topology that says whether a mesh is closed.
#pragma once

#include <napi.h>

// weldMesh(positions: Float64Array | Float32Array, indices: Uint32Array | null)
//   -> { positions: Float64Array, indices: Uint32Array,
//        openEdges, nonManifoldEdges, degenerateTriangles,
//        verticesBefore, verticesAfter }
Napi::Value WeldMesh(const Napi::CallbackInfo& info);
