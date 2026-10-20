// Freeform surfaces for the parts of a mesh no plane, cylinder, cone, sphere
// or torus holds: a cubic B-spline height field over a plane, fitted by least
// squares to a cluster of facets that all face within a narrow cone of one
// direction (so the cluster is one-valued over that plane).  Pure C++; the
// rebuild turns one into a Geom_BSplineSurface.
#pragma once

#include <memory>
#include <vector>

#include "mesh_fit.h"

namespace recog {

// Height h(x, y) above the plane through `origin` with axes ex, ey and normal
// n, a uniform cubic B-spline on nx x ny spans of [x0, x1] x [y0, y1], with
// (nx + 3) x (ny + 3) control heights c[i * (ny + 3) + j].
struct Freeform {
  V3 origin{0, 0, 0}, ex{1, 0, 0}, ey{0, 1, 0}, n{0, 0, 1};
  double x0 = 0, x1 = 1, y0 = 0, y1 = 1;
  int nx = 1, ny = 1;
  std::vector<double> c;
  double Height(double x, double y) const;
};

// The coarsest net whose surface holds every point within `tol` along `normal`,
// or null.  `origin` anchors the frame.
std::shared_ptr<const Freeform> FitFreeform(const std::vector<V3>& pts, const V3& normal,
                                            const V3& origin, double tol);

// Distance along the plane's normal from a point to the surface: no less than
// the true distance, so a point it puts within the tolerance is.
double FreeformDistance(const Freeform& f, const V3& p);

// The surface's tightest radius of curvature near a point, from the height's
// second derivatives (0 where it is flat).
double FreeformTightestRadius(const Freeform& f, const V3& p);

}  // namespace recog
