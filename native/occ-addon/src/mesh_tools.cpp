// Mesh tools built on meshoptimizer.  See mesh_tools.h.

#include "mesh_tools.h"

#include <cstdint>
#include <stdexcept>
#include <unordered_map>
#include <vector>

#include "meshoptimizer.h"

namespace {

struct Topology {
  uint32_t open = 0;
  uint32_t nonManifold = 0;
  uint32_t degenerate = 0;
};

// Undirected edge use counts over a welded index buffer.  Open (used once)
// means a hole; non-manifold (used three or more times) means sheets meeting
// along an edge.  A triangle that repeats a vertex after welding has zero area
// and bounds nothing, so it is counted apart and its edges ignored.
Topology CountEdges(const std::vector<uint32_t>& idx) {
  Topology t;
  std::unordered_map<uint64_t, uint32_t> uses;
  uses.reserve(idx.size());
  for (size_t f = 0; f + 2 < idx.size(); f += 3) {
    const uint32_t v[3] = {idx[f], idx[f + 1], idx[f + 2]};
    if (v[0] == v[1] || v[1] == v[2] || v[2] == v[0]) {
      t.degenerate++;
      continue;
    }
    for (int k = 0; k < 3; k++) {
      uint32_t a = v[k], b = v[(k + 1) % 3];
      if (a > b) std::swap(a, b);
      uses[(uint64_t(a) << 32) | b]++;
    }
  }
  for (const auto& e : uses) {
    if (e.second == 1)
      t.open++;
    else if (e.second > 2)
      t.nonManifold++;
  }
  return t;
}

}  // namespace

Napi::Value WeldMesh(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    if (info.Length() < 1 || !info[0].IsTypedArray())
      throw std::runtime_error("weldMesh: positions must be a typed array");

    // Positions arrive as doubles from the op layer; a Float32Array (straight
    // from an STL) is widened.  Either way the weld compares the doubles
    // bit-for-bit, so only EXACT duplicates merge and no point moves.
    std::vector<double> pos;
    Napi::TypedArray pArr = info[0].As<Napi::TypedArray>();
    if (pArr.TypedArrayType() == napi_float64_array) {
      auto p = info[0].As<Napi::Float64Array>();
      pos.assign(p.Data(), p.Data() + p.ElementLength());
    } else if (pArr.TypedArrayType() == napi_float32_array) {
      auto p = info[0].As<Napi::Float32Array>();
      pos.assign(p.Data(), p.Data() + p.ElementLength());
    } else {
      throw std::runtime_error("weldMesh: positions must be float");
    }
    const size_t vertexCount = pos.size() / 3;
    if (vertexCount < 3) throw std::runtime_error("weldMesh: too few vertices");

    // No index buffer: an STL's triangle soup, three private vertices each.
    std::vector<uint32_t> idx;
    if (info.Length() > 1 && info[1].IsTypedArray()) {
      auto i = info[1].As<Napi::Uint32Array>();
      idx.assign(i.Data(), i.Data() + i.ElementLength());
    } else {
      idx.resize(vertexCount);
      for (size_t i = 0; i < vertexCount; i++) idx[i] = uint32_t(i);
    }
    if (idx.size() % 3 != 0)
      throw std::runtime_error("weldMesh: index count is not a multiple of 3");
    for (uint32_t i : idx)
      if (i >= vertexCount)
        throw std::runtime_error("weldMesh: index out of range");

    std::vector<uint32_t> remap(vertexCount);
    const size_t unique = meshopt_generateVertexRemap(
        remap.data(), idx.data(), idx.size(), pos.data(), vertexCount,
        sizeof(double) * 3);

    std::vector<double> welded(unique * 3);
    meshopt_remapVertexBuffer(welded.data(), pos.data(), vertexCount,
                              sizeof(double) * 3, remap.data());
    std::vector<uint32_t> weldedIdx(idx.size());
    meshopt_remapIndexBuffer(weldedIdx.data(), idx.data(), idx.size(),
                             remap.data());

    const Topology topo = CountEdges(weldedIdx);

    auto outPos = Napi::Float64Array::New(env, welded.size());
    std::copy(welded.begin(), welded.end(), outPos.Data());
    auto outIdx = Napi::Uint32Array::New(env, weldedIdx.size());
    std::copy(weldedIdx.begin(), weldedIdx.end(), outIdx.Data());

    Napi::Object out = Napi::Object::New(env);
    out.Set("positions", outPos);
    out.Set("indices", outIdx);
    out.Set("openEdges", Napi::Number::New(env, topo.open));
    out.Set("nonManifoldEdges", Napi::Number::New(env, topo.nonManifold));
    out.Set("degenerateTriangles", Napi::Number::New(env, topo.degenerate));
    out.Set("verticesBefore", Napi::Number::New(env, double(vertexCount)));
    out.Set("verticesAfter", Napi::Number::New(env, double(unique)));
    return out;
  } catch (const std::exception& e) {
    throw Napi::Error::New(env, e.what());
  }
}
