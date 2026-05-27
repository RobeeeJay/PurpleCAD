#include <napi.h>

// Primitives
#include <BRepPrimAPI_MakeBox.hxx>

// Meshing
#include <BRepMesh_IncrementalMesh.hxx>

// Topology traversal
#include <TopExp_Explorer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>

// Geometry / triangulation access
#include <BRep_Tool.hxx>
#include <Poly_Triangulation.hxx>
#include <TopLoc_Location.hxx>

// Math types
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

#include <algorithm>
#include <cmath>
#include <vector>

// Smoke-test that the build chain loads the addon correctly.
Napi::String Ping(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), "pong");
}

// Full-pipeline smoke test: build a 2×2×2 cube (matching makeCube() in
// primitives.js), tessellate it, and return the raw flat arrays so a caller
// can construct a THREE.BufferGeometry.  The deflection mapping mirrors
// tessellate.js#deflectionFor so the visual result will match the WASM path.
//
// Returns { positions: Float32Array, indices: Uint32Array, triangleCount: number }
Napi::Object MakeCubeTessellated(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  double precision = 0.1;
  if (info.Length() > 0 && info[0].IsNumber()) {
    precision = info[0].As<Napi::Number>().DoubleValue();
  }

  // Mirrors tessellate.js#deflectionFor
  double linearDeflection = std::max(0.001, precision / 10.0);

  try {
    // Corner-to-corner constructor: (-1,-1,-1) → (1,1,1) = 2×2×2 at origin,
    // matching primitives.js#makeCube which uses BRepPrimAPI_MakeBox_3(p1, p2).
    gp_Pnt p1(-1, -1, -1);
    gp_Pnt p2(1, 1, 1);
    BRepPrimAPI_MakeBox boxMaker(p1, p2);
    TopoDS_Shape shape = boxMaker.Shape();

    // Same parameters as tessellate.js: isRelative=false, angular=0.3 rad.
    BRepMesh_IncrementalMesh mesher(shape, linearDeflection, false, 0.3, false);

    std::vector<float> positions;
    std::vector<uint32_t> indices;

    TopExp_Explorer explorer(shape, TopAbs_FACE);
    for (; explorer.More(); explorer.Next()) {
      TopoDS_Face face = TopoDS::Face(explorer.Current());
      TopLoc_Location loc;
      Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
      if (tri.IsNull()) continue;

      // Build the placement transform; default gp_Trsf() is identity.
      gp_Trsf trsf;
      if (!loc.IsIdentity()) {
        trsf = loc.Transformation();
      }

      bool reversed = (face.Orientation() == TopAbs_REVERSED);

      auto baseVert = static_cast<uint32_t>(positions.size() / 3);
      int nbNodes = tri->NbNodes();
      for (int i = 1; i <= nbNodes; i++) {
        gp_Pnt pnt = tri->Node(i).Transformed(trsf);
        positions.push_back(static_cast<float>(pnt.X()));
        positions.push_back(static_cast<float>(pnt.Y()));
        positions.push_back(static_cast<float>(pnt.Z()));
      }

      int nbTris = tri->NbTriangles();
      for (int i = 1; i <= nbTris; i++) {
        Standard_Integer n1, n2, n3;
        tri->Triangle(i).Get(n1, n2, n3);
        // OCC nodes are 1-based; convert to 0-based before storing.
        n1--; n2--; n3--;
        if (reversed) std::swap(n2, n3);
        indices.push_back(baseVert + static_cast<uint32_t>(n1));
        indices.push_back(baseVert + static_cast<uint32_t>(n2));
        indices.push_back(baseVert + static_cast<uint32_t>(n3));
      }
    }

    auto posBuf = Napi::Float32Array::New(env, positions.size());
    std::copy(positions.begin(), positions.end(), posBuf.Data());

    auto idxBuf = Napi::Uint32Array::New(env, indices.size());
    std::copy(indices.begin(), indices.end(), idxBuf.Data());

    Napi::Object result = Napi::Object::New(env);
    result.Set("positions", posBuf);
    result.Set("indices", idxBuf);
    result.Set("triangleCount", Napi::Number::New(env, static_cast<int>(indices.size() / 3)));
    return result;

  } catch (const std::exception& e) {
    throw Napi::Error::New(env, e.what());
  } catch (...) {
    throw Napi::Error::New(env, "Unknown OCC exception in makeCubeTessellated");
  }
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("ping", Napi::Function::New(env, Ping));
  exports.Set("makeCubeTessellated", Napi::Function::New(env, MakeCubeTessellated));
  return exports;
}

NODE_API_MODULE(occ_addon, Init)
