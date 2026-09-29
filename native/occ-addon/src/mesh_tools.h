// Mesh tools built on meshoptimizer (vendored in third_party/meshoptimizer):
// welding, the edge topology that says whether a mesh is closed, and
// simplification held to a measured deviation.
#pragma once

#include <napi.h>

// weldMesh(positions: Float64Array | Float32Array, indices: Uint32Array | null)
//   -> { positions: Float64Array, indices: Uint32Array,
//        openEdges, nonManifoldEdges, degenerateTriangles,
//        verticesBefore, verticesAfter }
Napi::Value WeldMesh(const Napi::CallbackInfo& info);

// simplifyMesh(positions, indices | null, mode: "deviation" | "triangles",
//              value: max deviation in the positions' units, or a triangle
//              count)
//   -> { positions: Float64Array, indices: Uint32Array, trianglesBefore,
//        trianglesAfter, maxDeviation, openEdges, nonManifoldEdges, attempts }
// Throws with a reason when the result would open holes or pinch the surface.
Napi::Value SimplifyMesh(const Napi::CallbackInfo& info);

// The cancel flag (binding.cc), for the long loops here.
bool MeshCancelRequested();
