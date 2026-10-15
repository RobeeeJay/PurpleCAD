// Boundary curves for the mesh rebuild (mesh_edges.h).

#include "mesh_edges.h"

#include <GeomAPI_IntSS.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Line.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Precision.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <gp_Circ.hxx>

#include <algorithm>
#include <cmath>

#include "mesh_fit.h"

namespace occ {

namespace {
using recog::V3;
gp_Pnt P(const V3& v) { return gp_Pnt(v[0], v[1], v[2]); }
gp_Dir D(const V3& v) { return gp_Dir(v[0], v[1], v[2]); }
}  // namespace

// The farthest any of `pts` is from the curve's span.
double Stray(const Curve& cv, const std::vector<gp_Pnt>& pts) {
  double worst = 0;
  for (const gp_Pnt& p : pts) {
    GeomAPI_ProjectPointOnCurve proj(p, cv.c, cv.u1, cv.u2);
    double d = proj.NbPoints() ? proj.LowerDistance() : 1e300;
    d = std::min({d, p.Distance(cv.c->Value(cv.u1)), p.Distance(cv.c->Value(cv.u2))});
    worst = std::max(worst, d);
  }
  return worst;
}

// The farthest the curve's span gets from the polyline through `pts`: the
// other way round from Stray.  A spline can pass within the tolerance of every
// point and still bulge between two close ones -- one did, 0.010 off the
// torus it bounded.
double Bulge(const Curve& cv, const std::vector<gp_Pnt>& pts) {
  const int n = int(pts.size()) * 4 + 8;
  double worst = 0;
  for (int i = 0; i <= n; i++) {
    const gp_Pnt p = cv.c->Value(cv.u1 + (cv.u2 - cv.u1) * i / n);
    double best = 1e300;
    for (size_t k = 0; k + 1 < pts.size(); k++) {
      const gp_Vec ab(pts[k], pts[k + 1]), ap(pts[k], p);
      const double L = ab.SquareMagnitude();
      const double t = L > 0 ? std::clamp(ap.Dot(ab) / L, 0.0, 1.0) : 0.0;
      best = std::min(best, p.Distance(pts[k].Translated(ab * t)));
    }
    worst = std::max(worst, best);
  }
  return worst;
}

// A line, an arc or a B-spline through the run's points, whichever is the
// simplest within `tol`; empty if none is.
Curve FitRun(const std::vector<gp_Pnt>& pts, bool closed, double tol) {
  const size_t n = pts.size();
  if (!closed) {
    const gp_Vec ab(pts.front(), pts.back());
    if (ab.Magnitude() > Precision::Confusion()) {
      Curve line;
      line.c = new Geom_Line(pts.front(), gp_Dir(ab));
      line.u1 = 0;
      line.u2 = ab.Magnitude();
      if (n == 2 || Stray(line, pts) <= tol) return line;
    }
  }
  if (n >= 4) {
    // A circle: its plane by the points' spread, then its centre there.
    std::vector<V3> q;
    for (const gp_Pnt& p : pts) q.push_back({p.X(), p.Y(), p.Z()});
    V3 mean{0, 0, 0};
    for (const V3& v : q) mean = recog::add(mean, v);
    mean = recog::mul(mean, 1.0 / n);
    recog::M3 cov{};
    for (const V3& v : q) {
      const V3 d = recog::sub(v, mean);
      for (int i = 0; i < 3; i++)
        for (int j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
    }
    const V3 nrm = recog::SmallestEigen(cov, nullptr);
    const V3 u = recog::unit(std::abs(nrm[0]) < 0.9 ? recog::cross(nrm, {1, 0, 0})
                                                    : recog::cross(nrm, {0, 1, 0}));
    const V3 w = recog::cross(nrm, u);
    double s[3][3] = {}, b[3] = {};
    for (const V3& v : q) {
      const V3 d = recog::sub(v, mean);
      const double x = recog::dot(d, u), y = recog::dot(d, w);
      const double row[3] = {x, y, 1};
      for (int i = 0; i < 3; i++) {
        for (int j = 0; j < 3; j++) s[i][j] += row[i] * row[j];
        b[i] -= row[i] * (x * x + y * y);
      }
    }
    auto det3 = [](double x[3][3]) {
      return x[0][0] * (x[1][1] * x[2][2] - x[1][2] * x[2][1]) -
             x[0][1] * (x[1][0] * x[2][2] - x[1][2] * x[2][0]) +
             x[0][2] * (x[1][0] * x[2][1] - x[1][1] * x[2][0]);
    };
    const double dd = det3(s);
    if (std::abs(dd) > 1e-30) {
      double sol[3];
      for (int col = 0; col < 3; col++) {
        double x[3][3];
        for (int i = 0; i < 3; i++)
          for (int j = 0; j < 3; j++) x[i][j] = j == col ? b[i] : s[i][j];
        sol[col] = det3(x) / dd;
      }
      const double cx = -sol[0] / 2, cy = -sol[1] / 2;
      const double R2 = cx * cx + cy * cy - sol[2];
      if (R2 > 0) {
        const V3 c = recog::add(mean, recog::add(recog::mul(u, cx), recog::mul(w, cy)));
        const V3 x0 = recog::unit(recog::sub(q.front(), c));
        gp_Ax2 ax(P(c), D(nrm), D(x0));
        Handle(Geom_Circle) circ = new Geom_Circle(gp_Circ(ax, std::sqrt(R2)));
        // Parameters along the run, unwrapped so they increase; if they fall
        // instead, the circle runs the other way round.
        auto paramOf = [&](const gp_Pnt& p) {
          GeomAPI_ProjectPointOnCurve proj(p, circ);
          return proj.NbPoints() ? proj.LowerDistanceParameter() : 0.0;
        };
        std::vector<double> ts{0};
        for (size_t i = 1; i < n; i++) {
          double t = paramOf(pts[i]);
          while (t < ts.back() - M_PI) t += 2 * M_PI;
          while (t > ts.back() + M_PI) t -= 2 * M_PI;
          ts.push_back(t);
        }
        if (ts.back() < 0) {
          circ = new Geom_Circle(gp_Circ(gp_Ax2(P(c), D(recog::mul(nrm, -1)), D(x0)), std::sqrt(R2)));
          for (double& t : ts) t = -t;
        }
        Curve arc;
        arc.c = circ;
        arc.u1 = 0;
        arc.u2 = closed ? 2 * M_PI : ts.back();
        if (arc.u2 > Precision::PConfusion() && arc.u2 <= 2 * M_PI + 1e-9 &&
            Stray(arc, pts) <= tol)
          return arc;
      }
    }
  }
  if (n >= 3) {
    TColgp_Array1OfPnt arr(1, int(n));
    for (size_t i = 0; i < n; i++) arr.SetValue(int(i + 1), pts[i]);
    GeomAPI_PointsToBSpline fit(arr, 2, 8, GeomAbs_C1, tol / 2);
    if (fit.IsDone()) {
      Curve sp;
      sp.c = fit.Curve();
      sp.u1 = sp.c->FirstParameter();
      sp.u2 = sp.c->LastParameter();
      if (Stray(sp, pts) <= tol && Bulge(sp, pts) <= tol) return sp;
    }
  }
  return {};
}


Curve IntersectionRun(const Handle(Geom_Surface)& s1, const Handle(Geom_Surface)& s2,
                      const std::vector<gp_Pnt>& pts, double tol) {
  if (s1.IsNull() || s2.IsNull() || pts.size() < 2) return {};
  GeomAPI_IntSS inter(s1, s2, tol);
  if (!inter.IsDone()) return {};
  const gp_Pnt& a = pts.front();
  const gp_Pnt& b = pts.back();
  // The middle of the run, to tell the two ways round a closed curve apart.
  const gp_Pnt mid = pts.size() > 2 ? pts[pts.size() / 2]
                                    : gp_Pnt((a.XYZ() + b.XYZ()) / 2);
  Curve best;
  double bestScore = 1e300;
  for (int i = 1; i <= inter.NbLines(); i++) {
    Handle(Geom_Curve) c = inter.Line(i);
    // A plane and a cone meet in a TRIMMED ellipse; a run across the trim's
    // ends gets a range outside it, and the edge built on that came out as
    // the straight chord again.  The full, periodic curve has no such ends.
    if (auto tc = Handle(Geom_TrimmedCurve)::DownCast(c); !tc.IsNull()) c = tc->BasisCurve();
    GeomAPI_ProjectPointOnCurve pa(a, c), pb(b, c);
    if (!pa.NbPoints() || !pb.NbPoints()) continue;
    // The run's ends are mesh vertices, each within the tolerance of both
    // surfaces, so within a few tolerances of where the surfaces meet.
    if (pa.LowerDistance() > 4 * tol || pb.LowerDistance() > 4 * tol) continue;
    double u1 = pa.LowerDistanceParameter(), u2 = pb.LowerDistanceParameter();
    std::vector<std::pair<double, double>> spans;
    if (c->IsPeriodic()) {
      const double per = c->Period();
      while (u2 < u1) u2 += per;
      spans = {{u1, u2}, {u2, u1 + per}};
    } else {
      spans = {{std::min(u1, u2), std::max(u1, u2)}};
    }
    for (auto [lo, hi] : spans) {
      if (hi - lo < Precision::PConfusion()) continue;
      Curve cv;
      cv.c = c;
      cv.u1 = lo;
      cv.u2 = hi;
      // Running the way round that passes the run's middle, and starting at
      // the run's first point, which is where its edge's first vertex is.
      if (c->Value(lo).Distance(a) > c->Value(lo).Distance(b)) {
        cv.c = c->Reversed();
        cv.u1 = c->ReversedParameter(hi);
        cv.u2 = c->ReversedParameter(lo);
      }
      GeomAPI_ProjectPointOnCurve pm(mid, cv.c, cv.u1, cv.u2);
      const double score = pm.NbPoints() ? pm.LowerDistance() : 1e300;
      if (score < bestScore) {
        bestScore = score;
        best = cv;
      }
    }
  }
  // The run's own vertices must lie along it, as for a fitted curve.
  if (best.c.IsNull() || Stray(best, pts) > 4 * tol) return {};
  return best;
}

}  // namespace occ
