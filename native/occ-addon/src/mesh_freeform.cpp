// Fitting a cubic B-spline height field to a cluster of mesh vertices
// (mesh_freeform.h).

#include "mesh_freeform.h"

#include <algorithm>
#include <cmath>

namespace recog {

namespace {

constexpr double kPointsPerHeight = 2;

// The four uniform cubic B-spline basis values at local parameter t in [0, 1].
void Basis(double t, double b[4]) {
  const double s = 1 - t;
  b[0] = s * s * s / 6;
  b[1] = (3 * t * t * t - 6 * t * t + 4) / 6;
  b[2] = (-3 * t * t * t + 3 * t * t + 3 * t + 1) / 6;
  b[3] = t * t * t / 6;
}

// The span a parameter falls in, and where in it.
int Span(double u, int n, double& local) {
  const int i = std::clamp(int(std::floor(u)), 0, n - 1);
  local = u - i;
  return i;
}

}  // namespace

double Freeform::Height(double x, double y) const {
  double tu, tv;
  const int iu = Span((x - x0) / (x1 - x0) * nx, nx, tu);
  const int iv = Span((y - y0) / (y1 - y0) * ny, ny, tv);
  double bu[4], bv[4];
  Basis(tu, bu);
  Basis(tv, bv);
  const int cy = ny + 3;
  double h = 0;
  for (int a = 0; a < 4; a++)
    for (int b = 0; b < 4; b++) h += bu[a] * bv[b] * c[(iu + a) * cy + iv + b];
  return h;
}

double FreeformDistance(const Freeform& f, const V3& p) {
  const V3 d = sub(p, f.origin);
  return std::abs(dot(d, f.n) - f.Height(dot(d, f.ex), dot(d, f.ey)));
}

double FreeformTightestRadius(const Freeform& f, const V3& p) {
  const V3 d = sub(p, f.origin);
  const double x = dot(d, f.ex), y = dot(d, f.ey);
  const double e = 1e-3 * std::max(f.x1 - f.x0, f.y1 - f.y0);
  const double h = f.Height(x, y);
  const double hx = (f.Height(x + e, y) - f.Height(x - e, y)) / (2 * e);
  const double hy = (f.Height(x, y + e) - f.Height(x, y - e)) / (2 * e);
  const double hxx = (f.Height(x + e, y) - 2 * h + f.Height(x - e, y)) / (e * e);
  const double hyy = (f.Height(x, y + e) - 2 * h + f.Height(x, y - e)) / (e * e);
  const double hxy = (f.Height(x + e, y + e) - f.Height(x + e, y - e) - f.Height(x - e, y + e) +
                      f.Height(x - e, y - e)) / (4 * e * e);
  // The Hessian's largest eigenvalue, over the slope's stretch: an upper
  // bound on the curvature in any direction.
  const double mean = (hxx + hyy) / 2, dev = std::hypot((hxx - hyy) / 2, hxy);
  const double k = (std::abs(mean) + dev) / std::sqrt(1 + hx * hx + hy * hy);
  return k > 1e-12 ? 1 / k : 0;
}

std::shared_ptr<const Freeform> FitFreeform(const std::vector<V3>& pts, const V3& normal,
                                            const V3& origin, double tol) {
  Freeform f;
  f.origin = origin;
  f.n = unit(normal);
  f.ex = unit(std::abs(f.n[0]) < 0.9 ? cross(f.n, {1, 0, 0}) : cross(f.n, {0, 1, 0}));
  f.ey = cross(f.n, f.ex);
  std::vector<V3> loc;
  f.x0 = f.y0 = 1e300;
  f.x1 = f.y1 = -1e300;
  for (const V3& p : pts) {
    const V3 d = sub(p, origin);
    loc.push_back({dot(d, f.ex), dot(d, f.ey), dot(d, f.n)});
    f.x0 = std::min(f.x0, loc.back()[0]);
    f.x1 = std::max(f.x1, loc.back()[0]);
    f.y0 = std::min(f.y0, loc.back()[1]);
    f.y1 = std::max(f.y1, loc.back()[1]);
  }
  if (loc.size() < 16 || !(f.x1 > f.x0) || !(f.y1 > f.y0)) return nullptr;
  // A margin, so the region's edges are well inside the surface.
  const double mx = 0.02 * (f.x1 - f.x0), my = 0.02 * (f.y1 - f.y0);
  f.x0 -= mx;
  f.x1 += mx;
  f.y0 -= my;
  f.y1 += my;
  const double aspect = (f.x1 - f.x0) / (f.y1 - f.y0);
  for (int spans = 1; spans <= 64; spans *= 2) {
    f.nx = std::max(1, int(std::lround(spans * std::min(1.0, aspect))));
    f.ny = std::max(1, int(std::lround(spans * std::min(1.0, 1 / aspect))));
    const int cx = f.nx + 3, cy = f.ny + 3, N = cx * cy;
    // A smooth surface sampled finely is held by a net far coarser than its
    // points.  One that needs a height for every two points or fewer is only
    // threading them: a low-poly fin's facets, drawn 5.6 mm apart and 0.08
    // off any local quadric, are its shape, and as freeform faces it came
    // out with more faces left as triangles, not fewer.
    if (N > double(loc.size()) / kPointsPerHeight || N > 1600) break;
    // Normal equations, banded: a point touches a 4 x 4 block of the net,
    // whose indices are within 3 * cy + 3 of each other.
    const int w = 3 * cy + 3;
    std::vector<double> A(size_t(N) * (w + 1), 0.0), b(N, 0.0);
    auto at = [&](int i, int j) -> double& { return A[size_t(i) * (w + 1) + (i - j)]; };  // j <= i
    for (const V3& q : loc) {
      double tu, tv, bu[4], bv[4];
      const int iu = Span((q[0] - f.x0) / (f.x1 - f.x0) * f.nx, f.nx, tu);
      const int iv = Span((q[1] - f.y0) / (f.y1 - f.y0) * f.ny, f.ny, tv);
      Basis(tu, bu);
      Basis(tv, bv);
      int idx[16];
      double wt[16];
      for (int a = 0; a < 4; a++)
        for (int k = 0; k < 4; k++) {
          idx[a * 4 + k] = (iu + a) * cy + iv + k;
          wt[a * 4 + k] = bu[a] * bv[k];
        }
      for (int i = 0; i < 16; i++) {
        b[idx[i]] += wt[i] * q[2];
        for (int j = 0; j < 16; j++)
          if (idx[j] <= idx[i]) at(idx[i], idx[j]) += wt[i] * wt[j];
      }
    }
    // A little bending energy, so heights no point pins stay smooth.
    const double lambda = 1e-6;
    auto bend = [&](int i0, int i1, int i2) {
      const int ids[3] = {i0, i1, i2};
      const double ws[3] = {1, -2, 1};
      for (int i = 0; i < 3; i++)
        for (int j = 0; j < 3; j++)
          if (ids[j] <= ids[i]) at(ids[i], ids[j]) += lambda * ws[i] * ws[j];
    };
    for (int i = 0; i < cx; i++)
      for (int j = 0; j < cy; j++) {
        if (i + 2 < cx) bend(i * cy + j, (i + 1) * cy + j, (i + 2) * cy + j);
        if (j + 2 < cy) bend(i * cy + j, i * cy + j + 1, i * cy + j + 2);
      }
    // Banded Cholesky, then the two triangular solves.
    bool ok = true;
    for (int j = 0; j < N && ok; j++) {
      double s = at(j, j) + 1e-12;
      for (int k = std::max(0, j - w); k < j; k++) s -= at(j, k) * at(j, k);
      if (s <= 0) {
        ok = false;
        break;
      }
      const double d = std::sqrt(s);
      at(j, j) = d;
      for (int i = j + 1; i <= std::min(N - 1, j + w); i++) {
        double t = at(i, j);
        for (int k = std::max(0, i - w); k < j; k++) t -= at(i, k) * at(j, k);
        at(i, j) = t / d;
      }
    }
    if (!ok) break;
    std::vector<double> y(N);
    for (int i = 0; i < N; i++) {
      double s = b[i];
      for (int k = std::max(0, i - w); k < i; k++) s -= at(i, k) * y[k];
      y[i] = s / at(i, i);
    }
    f.c.assign(N, 0.0);
    for (int i = N - 1; i >= 0; i--) {
      double s = y[i];
      for (int k = i + 1; k <= std::min(N - 1, i + w); k++) s -= at(k, i) * f.c[k];
      f.c[i] = s / at(i, i);
    }
    double worst = 0;
    for (const V3& q : loc) worst = std::max(worst, std::abs(q[2] - f.Height(q[0], q[1])));
    if (worst <= tol) return std::make_shared<const Freeform>(f);
  }
  return nullptr;
}

}  // namespace recog
