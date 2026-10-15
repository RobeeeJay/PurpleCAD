// Recognising planes, cylinders, cones and spheres in a triangle mesh
// (mesh_recognize.cpp).
#pragma once

#include "occ_js.h"

// recognizeSurfaces(positions, indices | null, tolerance, creaseDeg, flatDeg)
//   -> { regions, triangleRegion, counts, triangleCounts, triangles }
occjs::Val RecognizeSurfaces(occjs::Js& js);
