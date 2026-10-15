// The fits behind surface recognition (mesh_fit.h).  They rest on one
// property: the normal of a plane is constant, and the normal of a cylinder,
// cone, sphere or torus at any point passes through its axis (or centre, or
// centre circle).  A mesh's facets keep that property -- a cylinder's facet
// normal points straight at the axis from the middle of its chord -- so the
// facets alone say where the axis is.

#include "mesh_fit.h"

#include <algorithm>

namespace recog {
// Eigen-decomposition of a symmetric 3x3 by Jacobi rotations; returns the
// eigenvector of the SMALLEST eigenvalue, and that eigenvalue.
V3 SmallestEigen(M3 a, double* value) {
  M3 v = {{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}};
  for (int sweep = 0; sweep < 50; sweep++) {
    double off = a[0][1] * a[0][1] + a[0][2] * a[0][2] + a[1][2] * a[1][2];
    if (off < 1e-30) break;
    for (int p = 0; p < 2; p++)
      for (int q = p + 1; q < 3; q++) {
        if (std::abs(a[p][q]) < 1e-300) continue;
        const double theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const double t = (theta >= 0 ? 1 : -1) /
                         (std::abs(theta) + std::sqrt(theta * theta + 1));
        const double c = 1 / std::sqrt(t * t + 1), s = t * c;
        for (int k = 0; k < 3; k++) {
          const double akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (int k = 0; k < 3; k++) {
          const double apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (int k = 0; k < 3; k++) {
          const double vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  int m = 0;
  for (int i = 1; i < 3; i++)
    if (a[i][i] < a[m][m]) m = i;
  if (value) *value = a[m][m];
  return unit({v[0][m], v[1][m], v[2][m]});
}

// The region's distinct vertices.
std::vector<uint32_t> RegionVerts(const Mesh& m, const std::vector<uint32_t>& tris) {
  std::vector<uint32_t> vs;
  vs.reserve(tris.size() * 3);
  for (uint32_t t : tris)
    for (int k = 0; k < 3; k++) vs.push_back(m.idx[3 * t + k]);
  std::sort(vs.begin(), vs.end());
  vs.erase(std::unique(vs.begin(), vs.end()), vs.end());
  return vs;
}

Fit FitPlane(const Mesh& m, const std::vector<uint32_t>& vs) {
  V3 c{0, 0, 0};
  for (uint32_t v : vs) c = add(c, m.vert(v));
  c = mul(c, 1.0 / vs.size());
  M3 cov{};
  for (uint32_t v : vs) {
    const V3 d = sub(m.vert(v), c);
    for (int i = 0; i < 3; i++)
      for (int j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
  }
  Fit f;
  f.type = "plane";
  f.point = c;
  f.dir = SmallestEigen(cov, nullptr);
  for (uint32_t v : vs)
    f.dev = std::max(f.dev, std::abs(dot(sub(m.vert(v), c), f.dir)));
  return f;
}

// A sphere's centre is the point every facet normal passes through: the
// least-squares point of those lines.  Then the radius, and how far the
// vertices stray from it.
Fit FitSphere(const Mesh& m, const std::vector<uint32_t>& tris,
              const std::vector<V3>& normal, const std::vector<V3>& centroid,
              const std::vector<double>& area, const std::vector<uint32_t>& vs) {
  M3 a{};
  V3 b{0, 0, 0};
  for (uint32_t t : tris) {
    const V3& n = normal[t];
    const V3& p = centroid[t];
    for (int i = 0; i < 3; i++)
      for (int j = 0; j < 3; j++) {
        const double pij = (i == j ? 1 : 0) - n[i] * n[j];
        a[i][j] += area[t] * pij;
        b[i] += area[t] * pij * p[j];
      }
  }
  // Solve a c = b (3x3, Cramer).
  auto det = [](const M3& x) {
    return x[0][0] * (x[1][1] * x[2][2] - x[1][2] * x[2][1]) -
           x[0][1] * (x[1][0] * x[2][2] - x[1][2] * x[2][0]) +
           x[0][2] * (x[1][0] * x[2][1] - x[1][1] * x[2][0]);
  };
  const double d = det(a);
  Fit f;
  f.type = "sphere";
  if (std::abs(d) < 1e-18) {
    f.dev = 1e300;
    return f;
  }
  for (int col = 0; col < 3; col++) {
    M3 x = a;
    for (int r = 0; r < 3; r++) x[r][col] = b[r];
    f.point[col] = det(x) / d;
  }
  double sum = 0;
  for (uint32_t v : vs) sum += len(sub(m.vert(v), f.point));
  f.radius = sum / vs.size();
  for (uint32_t v : vs)
    f.dev = std::max(f.dev, std::abs(len(sub(m.vert(v), f.point)) - f.radius));
  return f;
}

// A cylinder or cone: facet normals lie in planes through the axis, so the
// axis direction is the one the normals spread least along (the smallest
// eigenvector of their covariance), and, seen down that axis, every normal
// line passes through it.  Then radius against height along the axis:
// constant for a cylinder, linear for a cone.
Fit FitRevolved(const Mesh& m, const std::vector<uint32_t>& tris,
                const std::vector<V3>& normal, const std::vector<V3>& centroid,
                const std::vector<double>& area, const std::vector<uint32_t>& vs,
                double tol) {
  Fit bad;
  bad.dev = 1e300;
  double wsum = 0;
  V3 nbar{0, 0, 0};
  for (uint32_t t : tris) {
    nbar = add(nbar, mul(normal[t], area[t]));
    wsum += area[t];
  }
  if (wsum <= 0) return bad;
  nbar = mul(nbar, 1 / wsum);
  M3 cov{};
  for (uint32_t t : tris) {
    const V3 d = sub(normal[t], nbar);
    for (int i = 0; i < 3; i++)
      for (int j = 0; j < 3; j++) cov[i][j] += area[t] * d[i] * d[j];
  }
  const V3 axis = SmallestEigen(cov, nullptr);
  // A frame across the axis, and the normal lines' least-squares meeting
  // point in it.
  const V3 u = unit(std::abs(axis[0]) < 0.9 ? cross(axis, {1, 0, 0}) : cross(axis, {0, 1, 0}));
  const V3 w = cross(axis, u);
  double a00 = 0, a01 = 0, a11 = 0, b0 = 0, b1 = 0;
  for (uint32_t t : tris) {
    double nx = dot(normal[t], u), ny = dot(normal[t], w);
    const double nl = std::hypot(nx, ny);
    if (nl < 1e-9) continue;
    nx /= nl;
    ny /= nl;
    const double px = dot(centroid[t], u), py = dot(centroid[t], w);
    const double wt = area[t] * nl;
    // (I - n n^T) projected to 2D.
    const double p00 = 1 - nx * nx, p01 = -nx * ny, p11 = 1 - ny * ny;
    a00 += wt * p00;
    a01 += wt * p01;
    a11 += wt * p11;
    b0 += wt * (p00 * px + p01 * py);
    b1 += wt * (p01 * px + p11 * py);
  }
  const double det = a00 * a11 - a01 * a01;
  if (std::abs(det) < 1e-18) return bad;
  const double cx = (b0 * a11 - b1 * a01) / det;
  const double cy = (a00 * b1 - a01 * b0) / det;
  const V3 c = add(mul(u, cx), mul(w, cy));
  // Height t along the axis and radius rho for each vertex; fit rho = k t + r0.
  std::vector<double> ts, rs;
  ts.reserve(vs.size());
  rs.reserve(vs.size());
  double st = 0, sr = 0, stt = 0, str = 0;
  for (uint32_t v : vs) {
    const V3 d = sub(m.vert(v), c);
    const double t = dot(d, axis);
    const double r = len(sub(d, mul(axis, t)));
    ts.push_back(t);
    rs.push_back(r);
    st += t;
    sr += r;
    stt += t * t;
    str += t * r;
  }
  const double n = double(vs.size());
  const double denom = n * stt - st * st;
  double k = denom > 1e-18 ? (n * str - st * sr) / denom : 0;
  double r0 = (sr - k * st) / n;
  Fit cyl;
  cyl.type = "cylinder";
  cyl.point = c;
  cyl.dir = axis;
  cyl.radius = sr / n;
  for (double r : rs) cyl.dev = std::max(cyl.dev, std::abs(r - cyl.radius));
  Fit cone;
  cone.type = "cone";
  cone.point = c;
  cone.dir = axis;
  cone.radius = r0;
  cone.halfAngle = std::atan(k);
  const double cosA = std::cos(cone.halfAngle);
  for (size_t i = 0; i < rs.size(); i++)
    cone.dev = std::max(cone.dev, std::abs(rs[i] - (k * ts[i] + r0)) * cosA);
  // A cylinder whenever one is within the tolerance: a cone barely tilted
  // from it always fits a little closer, and is the less useful answer.
  return cyl.dev <= std::max(cone.dev, tol) ? cyl : cone;
}

// Least squares on the vertices' distances from a torus, all seven
// parameters together (Levenberg-Marquardt, numeric derivatives).  The
// estimate from the facets is close but biased on a partial arc -- a quarter
// of a fillet came out 2% small with its axis tilted 0.7 degrees, three
// times the tolerance -- because a centroid sits off the surface by its
// chord's sag, and on a partial arc that doesn't cancel.
void RefineTorus(const Mesh& m, const std::vector<uint32_t>& vsAll, Fit& f) {
  std::vector<uint32_t> vs;
  const size_t stride = std::max<size_t>(1, vsAll.size() / 2000);
  for (size_t i = 0; i < vsAll.size(); i += stride) vs.push_back(vsAll[i]);
  const V3 d0 = f.dir;
  const V3 u = unit(std::abs(d0[0]) < 0.9 ? cross(d0, {1, 0, 0}) : cross(d0, {0, 1, 0}));
  const V3 w = cross(d0, u);
  // p: centre (3), axis tilt along u and w (2), R, r.
  std::array<double, 7> p = {f.point[0], f.point[1], f.point[2], 0, 0, f.radius,
                             f.minorRadius};
  auto residuals = [&](const std::array<double, 7>& q, std::vector<double>& out) {
    const V3 c{q[0], q[1], q[2]};
    const V3 d = unit(add(d0, add(mul(u, q[3]), mul(w, q[4]))));
    out.resize(vs.size());
    double sum = 0;
    for (size_t i = 0; i < vs.size(); i++) {
      const V3 e = sub(m.vert(vs[i]), c);
      const double h = dot(e, d);
      const double rho = len(sub(e, mul(d, h)));
      out[i] = std::hypot(rho - q[5], h) - q[6];
      sum += out[i] * out[i];
    }
    return sum;
  };
  std::vector<double> r0, r1;
  double cost = residuals(p, r0);
  double lambda = 1e-3;
  const double scale = std::max(f.radius, f.minorRadius);
  for (int it = 0; it < 40; it++) {
    std::vector<std::array<double, 7>> J(vs.size());
    for (int k = 0; k < 7; k++) {
      std::array<double, 7> q = p;
      const double h = (k == 3 || k == 4 ? 1 : scale) * 1e-7;
      q[k] += h;
      residuals(q, r1);
      for (size_t i = 0; i < vs.size(); i++) J[i][k] = (r1[i] - r0[i]) / h;
    }
    double A[7][7] = {}, g[7] = {};
    for (size_t i = 0; i < vs.size(); i++)
      for (int a = 0; a < 7; a++) {
        g[a] += J[i][a] * r0[i];
        for (int b = 0; b < 7; b++) A[a][b] += J[i][a] * J[i][b];
      }
    bool improved = false;
    for (int tries = 0; tries < 8 && !improved; tries++) {
      double M[7][8];
      for (int a = 0; a < 7; a++) {
        for (int b = 0; b < 7; b++) M[a][b] = A[a][b] + (a == b ? lambda * (A[a][a] + 1e-12) : 0);
        M[a][7] = -g[a];
      }
      // Gaussian elimination with partial pivoting.
      bool singular = false;
      for (int col = 0; col < 7 && !singular; col++) {
        int piv = col;
        for (int r = col + 1; r < 7; r++)
          if (std::abs(M[r][col]) > std::abs(M[piv][col])) piv = r;
        if (std::abs(M[piv][col]) < 1e-300) singular = true;
        else {
          std::swap(M[col], M[piv]);
          for (int r = col + 1; r < 7; r++) {
            const double k = M[r][col] / M[col][col];
            for (int c = col; c < 8; c++) M[r][c] -= k * M[col][c];
          }
        }
      }
      if (singular) {
        lambda *= 10;
        continue;
      }
      double step[7];
      for (int r = 6; r >= 0; r--) {
        double v = M[r][7];
        for (int c = r + 1; c < 7; c++) v -= M[r][c] * step[c];
        step[r] = v / M[r][r];
      }
      std::array<double, 7> q = p;
      for (int k = 0; k < 7; k++) q[k] += step[k];
      std::vector<double> rq;
      const double c2 = residuals(q, rq);
      if (c2 < cost) {
        p = q;
        r0 = std::move(rq);
        const double gain = cost - c2;
        cost = c2;
        lambda = std::max(lambda / 10, 1e-12);
        improved = true;
        if (gain < 1e-16 * (1 + cost)) it = 40;
      } else {
        lambda *= 10;
      }
    }
    if (!improved) break;
  }
  f.point = {p[0], p[1], p[2]};
  f.dir = unit(add(d0, add(mul(u, p[3]), mul(w, p[4]))));
  f.radius = p[5];
  f.minorRadius = std::abs(p[6]);
}

// A torus: follow each facet normal in by the tube radius r and it lands on
// the centre circle.  So for a trial r the shifted centroids should lie on one
// circle in 3D -- a plane by PCA, then a circle in it -- and the r that makes
// them fit best is the torus's.  r is scanned coarsely, both signs (a fillet
// in a corner has its centre outside the material), then refined.  Fillets
// round the rims of turned parts are this shape.
Fit FitTorus(const Mesh& m, const std::vector<uint32_t>& tris,
             const std::vector<V3>& normal, const std::vector<V3>& centroid,
             const std::vector<double>& area, const std::vector<uint32_t>& vs) {
  Fit bad;
  bad.dev = 1e300;
  V3 lo = m.vert(vs[0]), hi = lo;
  for (uint32_t v : vs)
    for (int k = 0; k < 3; k++) {
      lo[k] = std::min(lo[k], m.pos[3 * v + k]);
      hi[k] = std::max(hi[k], m.pos[3 * v + k]);
    }
  const double size = len(sub(hi, lo));
  if (size <= 0) return bad;

  struct Circle {
    V3 c, d;
    double R = 0, err = 1e300;
  };
  // The scan runs on an even sample of the facets: ~140 trial circles over a
  // 150k-triangle region took the cable tie from 1 s to 10 s.
  std::vector<uint32_t> sample;
  const size_t stride = std::max<size_t>(1, tris.size() / 1500);
  for (size_t i = 0; i < tris.size(); i += stride) sample.push_back(tris[i]);
  auto circleAt = [&](double r, const std::vector<uint32_t>& tris) {
    Circle out;
    double wsum = 0;
    V3 mean{0, 0, 0};
    for (uint32_t t : tris) {
      mean = add(mean, mul(sub(centroid[t], mul(normal[t], r)), area[t]));
      wsum += area[t];
    }
    if (wsum <= 0) return out;
    mean = mul(mean, 1 / wsum);
    M3 cov{};
    for (uint32_t t : tris) {
      const V3 q = sub(sub(centroid[t], mul(normal[t], r)), mean);
      for (int i = 0; i < 3; i++)
        for (int j = 0; j < 3; j++) cov[i][j] += area[t] * q[i] * q[j];
    }
    const V3 d = SmallestEigen(cov, nullptr);
    const V3 u = unit(std::abs(d[0]) < 0.9 ? cross(d, {1, 0, 0}) : cross(d, {0, 1, 0}));
    const V3 w = cross(d, u);
    // Circle in the plane, algebraically: x^2 + y^2 + D x + E y + F = 0.
    double s[3][3] = {}, b[3] = {};
    for (uint32_t t : tris) {
      const V3 q = sub(sub(centroid[t], mul(normal[t], r)), mean);
      const double x = dot(q, u), y = dot(q, w), z = -(x * x + y * y);
      const double row[3] = {x, y, 1};
      for (int i = 0; i < 3; i++) {
        for (int j = 0; j < 3; j++) s[i][j] += area[t] * row[i] * row[j];
        b[i] += area[t] * row[i] * z;
      }
    }
    auto det3 = [](double x[3][3]) {
      return x[0][0] * (x[1][1] * x[2][2] - x[1][2] * x[2][1]) -
             x[0][1] * (x[1][0] * x[2][2] - x[1][2] * x[2][0]) +
             x[0][2] * (x[1][0] * x[2][1] - x[1][1] * x[2][0]);
    };
    const double dd = det3(s);
    if (std::abs(dd) < 1e-30) return out;
    double sol[3];
    for (int col = 0; col < 3; col++) {
      double x[3][3];
      for (int i = 0; i < 3; i++)
        for (int j = 0; j < 3; j++) x[i][j] = j == col ? b[i] : s[i][j];
      sol[col] = det3(x) / dd;
    }
    const double cx = -sol[0] / 2, cy = -sol[1] / 2;
    const double R2 = cx * cx + cy * cy - sol[2];
    if (R2 <= 0) return out;
    out.c = add(mean, add(mul(u, cx), mul(w, cy)));
    out.d = d;
    out.R = std::sqrt(R2);
    out.err = 0;
    for (uint32_t t : tris) {
      const V3 q = sub(sub(centroid[t], mul(normal[t], r)), out.c);
      const double h = dot(q, d);
      const double rho = len(sub(q, mul(d, h)));
      out.err += area[t] * ((rho - out.R) * (rho - out.R) + h * h);
    }
    out.err /= wsum;
    return out;
  };

  double bestR = 0, bestErr = 1e300;
  // A seed patch is often smaller than the tube it lies on, so the scan runs
  // from a thousandth of the patch to a thousand times it.
  const int steps = 80;
  for (int sign = -1; sign <= 1; sign += 2)
    for (int i = 1; i <= steps; i++) {
      // Geometric spacing: tube radii run from fractions of a mm to the part.
      const double r = sign * size * std::pow(1e-3, 1 - 2 * double(i) / steps);
      const double e = circleAt(r, sample).err;
      if (e < bestErr) {
        bestErr = e;
        bestR = r;
      }
    }
  if (bestErr >= 1e300) return bad;
  // Golden-section refinement between the neighbouring scan points.
  double a = bestR * std::pow(1e-3, -2.0 / steps), c = bestR * std::pow(1e-3, 2.0 / steps);
  if (a > c) std::swap(a, c);
  const double g = (std::sqrt(5.0) - 1) / 2;
  double x1 = c - g * (c - a), x2 = a + g * (c - a);
  double f1 = circleAt(x1, sample).err, f2 = circleAt(x2, sample).err;
  for (int it = 0; it < 60; it++) {
    if (f1 < f2) {
      c = x2;
      x2 = x1;
      f2 = f1;
      x1 = c - g * (c - a);
      f1 = circleAt(x1, sample).err;
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + g * (c - a);
      f2 = circleAt(x2, sample).err;
    }
  }
  const Circle best = circleAt((a + c) / 2, tris);
  if (best.err >= 1e300) return bad;
  // The centroids sit inside the surface by the chord's sag, which biases
  // both radii by about that much.  The centre circle's plane and middle are
  // symmetric to it; the radii are refitted from the vertices: in the
  // (distance from axis, height) plane they lie on a circle centred (R, 0),
  // rho^2 + h^2 = 2 R rho - (R^2 - r^2), linear in R and R^2 - r^2.
  double s00 = 0, s01 = 0, s11 = 0, b0 = 0, b1 = 0;
  for (uint32_t v : vs) {
    const V3 q = sub(m.vert(v), best.c);
    const double h = dot(q, best.d);
    const double rho = len(sub(q, mul(best.d, h)));
    const double y = rho * rho + h * h;
    s00 += 4 * rho * rho;
    s01 += -2 * rho;
    s11 += 1;
    b0 += 2 * rho * y;
    b1 += -y;
  }
  const double det = s00 * s11 - s01 * s01;
  if (std::abs(det) < 1e-30) return bad;
  const double R = (b0 * s11 - b1 * s01) / det;
  const double K = (s00 * b1 - s01 * b0) / det;
  if (R * R - K <= 0) return bad;
  // Only a ring torus, whose tube clears the axis: with R <= r it is the
  // self-intersecting kind (R near 0 is a sphere, which FitSphere covers),
  // and nothing a face can be rebuilt on.
  if (R <= std::sqrt(R * R - K)) return bad;
  Fit f;
  f.type = "torus";
  f.point = best.c;
  f.dir = best.d;
  f.radius = R;
  f.minorRadius = std::sqrt(R * R - K);
  RefineTorus(m, vs, f);
  if (f.radius <= f.minorRadius) return bad;
  for (uint32_t v : vs) f.dev = std::max(f.dev, Distance(f, m.vert(v)));
  return f;
}

namespace {

// The distance from (px, py) to the ellipse x = a cos t, y = b sin t, by
// Newton's method on the angle of the nearest point.
double EllipseDistance(double a, double b, double px, double py) {
  double t = std::atan2(py * a, px * b);
  for (int i = 0; i < 20; i++) {
    const double c = std::cos(t), s = std::sin(t);
    const double f = (a * a - b * b) * c * s - px * a * s + py * b * c;
    const double df = (a * a - b * b) * (c * c - s * s) - px * a * c - py * b * s;
    if (std::abs(df) < 1e-300) break;
    const double step = f / df;
    t -= step;
    if (std::abs(step) < 1e-14) break;
  }
  return std::hypot(px - a * std::cos(t), py - b * std::sin(t));
}

// The real roots of x^3 + p x^2 + q x + r.
std::vector<double> CubicRoots(double p, double q, double r) {
  const double a = q - p * p / 3, b = 2 * p * p * p / 27 - p * q / 3 + r;
  const double disc = b * b / 4 + a * a * a / 27;
  std::vector<double> out;
  if (disc > 0) {
    const double sq = std::sqrt(disc);
    out.push_back(std::cbrt(-b / 2 + sq) + std::cbrt(-b / 2 - sq) - p / 3);
  } else {
    const double rr = std::sqrt(-a * a * a / 27);
    const double phi = std::acos(std::clamp(-b / (2 * rr), -1.0, 1.0));
    const double m = 2 * std::cbrt(rr);
    for (int k = 0; k < 3; k++) out.push_back(m * std::cos((phi + 2 * M_PI * k) / 3) - p / 3);
  }
  return out;
}

}  // namespace

Fit FitEllipticCylinder(const Mesh& m, const std::vector<uint32_t>& tris,
                        const std::vector<V3>& normal, const std::vector<double>& area,
                        const std::vector<uint32_t>& vs) {
  Fit bad;
  bad.dev = 1e300;
  // The axis: the direction the normals spread least along (they are all
  // across it), as for a round cylinder.
  double wsum = 0;
  V3 nbar{0, 0, 0};
  for (uint32_t t : tris) {
    nbar = add(nbar, mul(normal[t], area[t]));
    wsum += area[t];
  }
  if (wsum <= 0 || vs.size() < 10) return bad;
  nbar = mul(nbar, 1 / wsum);
  M3 cov{};
  for (uint32_t t : tris) {
    const V3 d = sub(normal[t], nbar);
    for (int i = 0; i < 3; i++)
      for (int j = 0; j < 3; j++) cov[i][j] += area[t] * d[i] * d[j];
  }
  const V3 axis = SmallestEigen(cov, nullptr);
  const V3 u = unit(std::abs(axis[0]) < 0.9 ? cross(axis, {1, 0, 0}) : cross(axis, {0, 1, 0}));
  const V3 w = cross(axis, u);
  // The vertices seen down the axis, centred and scaled for conditioning.
  std::vector<double> xs, ys;
  double mx = 0, my = 0;
  for (uint32_t v : vs) {
    xs.push_back(dot(m.vert(v), u));
    ys.push_back(dot(m.vert(v), w));
    mx += xs.back();
    my += ys.back();
  }
  const double n = double(vs.size());
  mx /= n;
  my /= n;
  double sc = 0;
  for (size_t i = 0; i < xs.size(); i++) sc = std::max({sc, std::abs(xs[i] - mx), std::abs(ys[i] - my)});
  if (sc <= 0) return bad;
  // Direct least-squares ellipse (Halir and Flusser's form of Fitzgibbon's):
  // the conic a x^2 + b xy + c y^2 + d x + e y + f = 0 nearest the points
  // with 4ac - b^2 = 1, which only an ellipse satisfies.
  double S1[3][3] = {}, S2[3][3] = {}, S3[3][3] = {};
  for (size_t i = 0; i < xs.size(); i++) {
    const double x = (xs[i] - mx) / sc, y = (ys[i] - my) / sc;
    const double d1[3] = {x * x, x * y, y * y}, d2[3] = {x, y, 1};
    for (int r = 0; r < 3; r++)
      for (int c = 0; c < 3; c++) {
        S1[r][c] += d1[r] * d1[c];
        S2[r][c] += d1[r] * d2[c];
        S3[r][c] += d2[r] * d2[c];
      }
  }
  auto det3 = [](const double x[3][3]) {
    return x[0][0] * (x[1][1] * x[2][2] - x[1][2] * x[2][1]) -
           x[0][1] * (x[1][0] * x[2][2] - x[1][2] * x[2][0]) +
           x[0][2] * (x[1][0] * x[2][1] - x[1][1] * x[2][0]);
  };
  const double d3 = det3(S3);
  if (std::abs(d3) < 1e-30) return bad;
  double inv3[3][3];
  for (int r = 0; r < 3; r++)
    for (int c = 0; c < 3; c++) {
      const int r1 = (c + 1) % 3, r2 = (c + 2) % 3, c1 = (r + 1) % 3, c2 = (r + 2) % 3;
      inv3[r][c] = (S3[r1][c1] * S3[r2][c2] - S3[r1][c2] * S3[r2][c1]) / d3;
    }
  // T = -S3^-1 S2^T;  M = S1 + S2 T;  then C1^-1 M.
  double T[3][3] = {}, M[3][3];
  for (int r = 0; r < 3; r++)
    for (int c = 0; c < 3; c++)
      for (int k = 0; k < 3; k++) T[r][c] -= inv3[r][k] * S2[c][k];
  for (int r = 0; r < 3; r++)
    for (int c = 0; c < 3; c++) {
      M[r][c] = S1[r][c];
      for (int k = 0; k < 3; k++) M[r][c] += S2[r][k] * T[k][c];
    }
  double Mp[3][3];
  for (int c = 0; c < 3; c++) {
    Mp[0][c] = M[2][c] / 2;
    Mp[1][c] = -M[1][c];
    Mp[2][c] = M[0][c] / 2;
  }
  // Its eigenvectors, from the characteristic cubic and a null vector of
  // (Mp - lambda I) as the cross product of two of its rows.
  const double tr = Mp[0][0] + Mp[1][1] + Mp[2][2];
  const double minors = Mp[0][0] * Mp[1][1] - Mp[0][1] * Mp[1][0] + Mp[0][0] * Mp[2][2] -
                        Mp[0][2] * Mp[2][0] + Mp[1][1] * Mp[2][2] - Mp[1][2] * Mp[2][1];
  double best[3] = {0, 0, 0};
  bool found = false;
  for (double lambda : CubicRoots(-tr, minors, -det3(Mp))) {
    const V3 r0{Mp[0][0] - lambda, Mp[0][1], Mp[0][2]};
    const V3 r1{Mp[1][0], Mp[1][1] - lambda, Mp[1][2]};
    const V3 r2{Mp[2][0], Mp[2][1], Mp[2][2] - lambda};
    V3 v = cross(r0, r1);
    if (len(v) < 1e-12) v = cross(r0, r2);
    if (len(v) < 1e-12) v = cross(r1, r2);
    if (len(v) < 1e-12) continue;
    if (4 * v[0] * v[2] - v[1] * v[1] > 0) {
      best[0] = v[0];
      best[1] = v[1];
      best[2] = v[2];
      found = true;
    }
  }
  if (!found) return bad;
  double con[6] = {best[0], best[1], best[2], 0, 0, 0};
  for (int r = 0; r < 3; r++)
    for (int k = 0; k < 3; k++) con[3 + r] += T[r][k] * best[k];
  // Centre, axes and turn of the conic, back in the unscaled frame.
  const double A = con[0], Bc = con[1], C = con[2], Dc = con[3], E = con[4], Fc = con[5];
  const double den = Bc * Bc - 4 * A * C;
  if (std::abs(den) < 1e-30) return bad;
  const double cx = (2 * C * Dc - Bc * E) / den, cy = (2 * A * E - Bc * Dc) / den;
  const double theta = 0.5 * std::atan2(Bc, A - C);
  const double ct = std::cos(theta), st = std::sin(theta);
  const double Ap = A * ct * ct + Bc * ct * st + C * st * st;
  const double Cp = A * st * st - Bc * ct * st + C * ct * ct;
  const double Fp = A * cx * cx + Bc * cx * cy + C * cy * cy + Dc * cx + E * cy + Fc;
  if (Ap * Fp >= 0 || Cp * Fp >= 0) return bad;
  double a = std::sqrt(-Fp / Ap) * sc, b = std::sqrt(-Fp / Cp) * sc;
  // A real oval, the size of the region: squashed flat (b = 0.010 on a
  // 22 mm one) it passes for a pair of near-parallel facet strips, and
  // stretched (a = 4,536) for a nearly flat sheet.
  if (std::min(a, b) < 0.1 * std::max(a, b) || std::max(a, b) > 2 * sc) return bad;
  V3 xd = add(mul(u, ct), mul(w, st));
  if (a < b) {
    std::swap(a, b);
    xd = cross(axis, xd);
  }
  Fit f;
  f.type = "ellipticCylinder";
  f.point = add(mul(u, cx * sc + mx), mul(w, cy * sc + my));
  f.dir = axis;
  f.xdir = unit(xd);
  f.radius = a;
  f.minorRadius = b;
  for (uint32_t v : vs) f.dev = std::max(f.dev, Distance(f, m.vert(v)));
  return f;
}

// How far a point is from a fitted surface.
double Distance(const Fit& f, const V3& p) {
  const V3 d = sub(p, f.point);
  if (f.type == "plane") return std::abs(dot(d, f.dir));
  if (f.type == "sphere") return std::abs(len(d) - f.radius);
  const double t = dot(d, f.dir);
  const double rho = len(sub(d, mul(f.dir, t)));
  if (f.type == "cylinder") return std::abs(rho - f.radius);
  if (f.type == "cone")
    return std::abs(rho - (f.radius + std::tan(f.halfAngle) * t)) * std::cos(f.halfAngle);
  if (f.type == "torus") return std::abs(std::hypot(rho - f.radius, t) - f.minorRadius);
  if (f.type == "ellipticCylinder") {
    const V3 ydir = cross(f.dir, f.xdir);
    return EllipseDistance(f.radius, f.minorRadius, dot(d, f.xdir), dot(d, ydir));
  }
  return 1e300;
}

}  // namespace recog
