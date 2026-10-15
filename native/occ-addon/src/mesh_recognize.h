// Recognising planes, cylinders, cones, spheres and tori in a triangle mesh
// (mesh_recognize.cpp).
#pragma once

#include <array>
#include <cstdint>
#include <vector>

#include "mesh_fit.h"
#include "occ_js.h"

// The welded mesh, its regions and which region each triangle is in.
struct Recognition {
  recog::Mesh mesh;
  std::vector<recog::Region> regions;
  std::vector<int64_t> regionOf;
  // Each triangle's neighbour across each edge, -1 where it isn't manifold.
  std::vector<std::array<int64_t, 3>> nbr;
  std::vector<double> area;
  std::vector<recog::V3> normal;
};

Recognition Recognize(std::vector<double> pos, const std::vector<uint32_t>& idx,
                      double tol, double creaseDeg = 30, double flatDeg = 0.5);

// recognizeSurfaces(positions, indices | null, tolerance, creaseDeg, flatDeg)
//   -> { regions, triangleRegion, counts, triangleCounts, triangles }
occjs::Val RecognizeSurfaces(occjs::Js& js);
