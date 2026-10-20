// Fitting planes, cylinders, cones, spheres and tori to the facets of a mesh
// (mesh_fit.cpp), shared by the recogniser (mesh_recognize.cpp) and the
// rebuild (mesh_rebuild.cpp).
#pragma once

#include <array>
#include <cmath>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace recog {

using V3 = std::array<double, 3>;

inline V3 sub(const V3& a, const V3& b) { return {a[0] - b[0], a[1] - b[1], a[2] - b[2]}; }
inline V3 add(const V3& a, const V3& b) { return {a[0] + b[0], a[1] + b[1], a[2] + b[2]}; }
inline V3 mul(const V3& a, double s) { return {a[0] * s, a[1] * s, a[2] * s}; }
inline double dot(const V3& a, const V3& b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
inline V3 cross(const V3& a, const V3& b) {
  return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]};
}
inline double len(const V3& a) { return std::sqrt(dot(a, a)); }
inline V3 unit(const V3& a) {
  const double l = len(a);
  return l > 0 ? mul(a, 1 / l) : V3{0, 0, 0};
}

using M3 = std::array<std::array<double, 3>, 3>;

// Eigenvector of a symmetric 3x3's SMALLEST eigenvalue (and the value).
V3 SmallestEigen(M3 a, double* value);

struct Mesh {
  std::vector<double> pos;
  std::vector<uint32_t> idx;
  size_t tris() const { return idx.size() / 3; }
  V3 vert(uint32_t i) const { return {pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]}; }
};

struct Freeform;  // mesh_freeform.h

// What a region was recognised as.  "mesh" stays triangles.
struct Fit {
  std::string type = "mesh";
  double dev = 0;
  V3 point{0, 0, 0};   // plane: a point on it; cylinder/cone: on the axis; sphere: centre
  V3 dir{0, 0, 0};     // plane: normal; cylinder/cone: axis
  double radius = 0;   // cylinder, sphere; cone: radius at `point`
  double halfAngle = 0;  // cone
  double minorRadius = 0;  // torus: tube radius; `radius` is the centre circle's
                           // ellipticCylinder: semi-minor axis; `radius` the semi-major
  V3 xdir{0, 0, 0};    // ellipticCylinder: the direction of the major axis
  std::shared_ptr<const Freeform> freeform;  // bspline: its surface
};

struct Region {
  std::vector<uint32_t> tris;
  Fit fit;
  double area = 0;
  // A freeform region: the regions its facets were in before, given back if
  // its face won't hold in the rebuild.
  std::vector<Region> before;
  // For one of those: the region the rest of its facets are still in, which
  // it rejoins (-1 if none is left).
  int64_t home = -1;
};

std::vector<uint32_t> RegionVerts(const Mesh& m, const std::vector<uint32_t>& tris);
Fit FitPlane(const Mesh& m, const std::vector<uint32_t>& vs);
Fit FitSphere(const Mesh& m, const std::vector<uint32_t>& tris,
              const std::vector<V3>& normal, const std::vector<V3>& centroid,
              const std::vector<double>& area, const std::vector<uint32_t>& vs);
Fit FitRevolved(const Mesh& m, const std::vector<uint32_t>& tris,
                const std::vector<V3>& normal, const std::vector<V3>& centroid,
                const std::vector<double>& area, const std::vector<uint32_t>& vs,
                double tol = 0);
Fit FitTorus(const Mesh& m, const std::vector<uint32_t>& tris,
             const std::vector<V3>& normal, const std::vector<V3>& centroid,
             const std::vector<double>& area, const std::vector<uint32_t>& vs);
// An elliptical cylinder (an oval wall): the axis from the normals, as for a
// cylinder, and an ellipse fitted to the vertices seen down it.
Fit FitEllipticCylinder(const Mesh& m, const std::vector<uint32_t>& tris,
                        const std::vector<V3>& normal, const std::vector<double>& area,
                        const std::vector<uint32_t>& vs);
// How far a point is from a fitted surface.
double Distance(const Fit& f, const V3& p);
// The surface's tightest radius of curvature near a point (0 for a plane).
double TightestRadius(const Fit& f, const V3& p);

}  // namespace recog
