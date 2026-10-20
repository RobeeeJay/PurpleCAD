// The curves a rebuilt solid's edges are made of (mesh_edges.cpp): each run
// of boundary between two regions becomes one, fitted through the run's mesh
// vertices or, where two exact surfaces meet, cut from their intersection.
#pragma once

#include <Geom_Curve.hxx>
#include <Geom_Surface.hxx>
#include <gp_Pnt.hxx>
#include <vector>

namespace occ {

struct Curve {
  Handle(Geom_Curve) c;
  double u1 = 0, u2 = 0;
};

// The farthest any of `pts` is from the curve's span.
double Stray(const Curve& cv, const std::vector<gp_Pnt>& pts);
// The farthest the curve's span gets from the polyline through `pts`.
double Bulge(const Curve& cv, const std::vector<gp_Pnt>& pts);
// A line, an arc or a B-spline through the run's points, whichever is the
// simplest within `tol`; empty if none is.
Curve FitRun(const std::vector<gp_Pnt>& pts, bool closed, double tol);
// The piece of the two surfaces' intersection that runs from the run's first
// point to its last, past the others; empty if there is none close enough.
Curve IntersectionRun(const Handle(Geom_Surface)& s1, const Handle(Geom_Surface)& s2,
                      const std::vector<gp_Pnt>& pts, double tol);

}  // namespace occ
