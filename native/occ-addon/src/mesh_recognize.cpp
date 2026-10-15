// Recognising exact surfaces in a triangle mesh: which regions of an STL are
// really planes, cylinders, cones or spheres, within a tolerance.  This step
// only FINDS them and reports what it found (docs/exact-imports-plan.md, Part
// Two); nothing here builds geometry.
//
// OCC's ShapeAnalysis_CanonicalRecognition was tried first and rejects a
// shell of flat triangle faces outright (status 1 at every tolerance), so the
// fitting is our own.  It rests on one property: the normal of a plane is
// constant, and the normal of a cylinder, cone or sphere at any point passes
// through its axis (or centre).  A mesh's facets keep that property -- a
// cylinder's facet normal points straight at the axis from the middle of its
// chord -- so the facets alone say where the axis is.

#include "mesh_recognize.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

#include "mesh_tools.h"

namespace {

using V3 = std::array<double, 3>;

V3 sub(const V3& a, const V3& b) { return {a[0] - b[0], a[1] - b[1], a[2] - b[2]}; }
V3 add(const V3& a, const V3& b) { return {a[0] + b[0], a[1] + b[1], a[2] + b[2]}; }
V3 mul(const V3& a, double s) { return {a[0] * s, a[1] * s, a[2] * s}; }
double dot(const V3& a, const V3& b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
V3 cross(const V3& a, const V3& b) {
  return {a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]};
}
double len(const V3& a) { return std::sqrt(dot(a, a)); }
V3 unit(const V3& a) {
  const double l = len(a);
  return l > 0 ? mul(a, 1 / l) : V3{0, 0, 0};
}

using M3 = std::array<std::array<double, 3>, 3>;

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

struct Mesh {
  std::vector<double> pos;
  std::vector<uint32_t> idx;
  size_t tris() const { return idx.size() / 3; }
  V3 vert(uint32_t i) const { return {pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]}; }
};

// What a region was recognised as.  "mesh" stays triangles.
struct Fit {
  std::string type = "mesh";
  double dev = 0;
  V3 point{0, 0, 0};   // plane: a point on it; cylinder/cone: on the axis; sphere: centre
  V3 dir{0, 0, 0};     // plane: normal; cylinder/cone: axis
  double radius = 0;   // cylinder, sphere; cone: radius at `point`
  double halfAngle = 0;  // cone
};

struct Region {
  std::vector<uint32_t> tris;
  Fit fit;
  double area = 0;
};

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
                const std::vector<double>& area, const std::vector<uint32_t>& vs) {
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
  return cyl.dev <= cone.dev ? cyl : cone;
}

}  // namespace

// recognizeSurfaces(positions, indices | null, tolerance, creaseDeg = 30,
//                   flatDeg = 0.5)
//   -> { regions: [{ type, triangles, area, deviation, ... }],
//        triangleRegion: Uint32Array, counts: { plane, cylinder, ... } }
// Positions are in the mesh's own units (an STL's mm); so is the tolerance.
occjs::Val RecognizeSurfaces(occjs::Js& js) {
  if (js.argc() < 3)
    throw std::runtime_error("recognizeSurfaces: expected positions, indices, tolerance");
  std::vector<double> pos = ReadPositions(js, js[0], "recognizeSurfaces");
  const size_t vertexCount = pos.size() / 3;
  if (vertexCount < 3) throw std::runtime_error("recognizeSurfaces: too few vertices");
  const std::vector<uint32_t> idx = ReadIndices(js, 1, vertexCount, "recognizeSurfaces");
  const double tol = js.num(js[2], 0.01);
  const double creaseDeg = js.argc() > 3 ? js.num(js[3], 30.0) : 30.0;
  const double flatDeg = js.argc() > 4 ? js.num(js[4], 0.5) : 0.5;
  const double cosCrease = std::cos(creaseDeg * M_PI / 180);
  const double cosFlat = std::cos(flatDeg * M_PI / 180);

  Welded w = Weld(std::move(pos), idx);
  Mesh m{std::move(w.pos), std::move(w.idx)};
  const size_t T = m.tris();
  const size_t V = m.pos.size() / 3;

  std::vector<V3> normal(T), centroid(T);
  std::vector<double> area(T);
  for (size_t t = 0; t < T; t++) {
    const V3 a = m.vert(m.idx[3 * t]), b = m.vert(m.idx[3 * t + 1]),
             c = m.vert(m.idx[3 * t + 2]);
    const V3 n = cross(sub(b, a), sub(c, a));
    area[t] = len(n) / 2;
    normal[t] = unit(n);
    // A sliver (an OCC sphere's pole has a row of them) has no trustworthy
    // normal: zero its area so it joins its neighbours instead of standing as
    // a region of its own.
    const double longest = std::max({len(sub(b, a)), len(sub(c, b)), len(sub(a, c))});
    if (longest == 0 || 2 * area[t] / longest < 1e-6 * tol) area[t] = 0;
    centroid[t] = mul(add(add(a, b), c), 1.0 / 3);
  }

  // Neighbours across manifold edges (exactly two triangles on the edge).
  std::unordered_map<uint64_t, std::vector<uint32_t>> edgeTris;
  edgeTris.reserve(T * 2);
  auto key = [](uint32_t a, uint32_t b) {
    if (a > b) std::swap(a, b);
    return (uint64_t(a) << 32) | b;
  };
  // Welding can collapse a sliver onto a line (an OCC sphere's poles):
  // its edges would make its neighbours' edges non-manifold, so it is left out
  // of the segmentation and given to a neighbour afterwards.
  std::vector<char> collapsed(T, 0);
  for (size_t t = 0; t < T; t++) {
    const uint32_t* v = &m.idx[3 * t];
    collapsed[t] = v[0] == v[1] || v[1] == v[2] || v[2] == v[0];
  }
  for (size_t t = 0; t < T; t++)
    if (!collapsed[t])
      for (int k = 0; k < 3; k++)
        edgeTris[key(m.idx[3 * t + k], m.idx[3 * t + (k + 1) % 3])].push_back(uint32_t(t));
  std::vector<std::array<int64_t, 3>> nbr(T, {-1, -1, -1});
  for (size_t t = 0; t < T; t++)
    for (int k = 0; k < 3; k++) {
      const auto& es = edgeTris[key(m.idx[3 * t + k], m.idx[3 * t + (k + 1) % 3])];
      if (es.size() == 2) nbr[t][k] = es[0] == t ? es[1] : es[0];
    }

  std::vector<int64_t> regionOf(T, -1);
  for (size_t t = 0; t < T; t++)
    if (collapsed[t]) regionOf[t] = -4;
  std::vector<Region> regions;

  // The simplest surface the region's vertices all lie within `tol` of:
  // plane, then cylinder, then cone, then sphere.  Simplest first because a
  // coarse mesh under-determines the rest -- a cylinder wall meshed with
  // vertices only on its two rims has every vertex the same distance from its
  // centre, and fits a sphere perfectly.
  auto fitRegion = [&](const std::vector<uint32_t>& tris) {
    const auto vs = RegionVerts(m, tris);
    const Fit plane = FitPlane(m, vs);
    if (plane.dev <= tol) return plane;
    // A cylinder has five parameters and a cone six: through a handful of
    // vertices one always passes exactly (a 4-triangle fan on a printed tower
    // "fitted" a sphere to 1e-15), so a curved fit needs points to spare.
    if (vs.size() < 10) {
      Fit f;
      f.dev = plane.dev;
      return f;
    }
    const Fit rev = FitRevolved(m, tris, normal, centroid, area, vs);
    if (rev.dev <= tol) return rev;
    const Fit sph = FitSphere(m, tris, normal, centroid, area, vs);
    if (sph.dev <= tol) return sph;
    Fit f;  // stays triangles; remember how near the nearest fit came
    f.dev = std::min({plane.dev, rev.dev, sph.dev});
    return f;
  };

  // The largest coplanar patch of `tris`: connected triangles facing the same
  // way on the same plane.
  std::vector<int64_t> mark(T, -1);
  auto largestCoplanarPatch = [&](const std::vector<uint32_t>& tris, int64_t tag) {
    for (uint32_t t : tris) mark[t] = tag;
    std::vector<uint32_t> best;
    double bestArea = 0, totalArea = 0;
    size_t patches = 0;
    std::unordered_map<uint32_t, char> done;
    for (uint32_t s0 : tris) {
      totalArea += area[s0];
      if (done.count(s0) || area[s0] <= 0) continue;
      std::vector<uint32_t> patch, stack{s0};
      done[s0] = 1;
      double a = 0;
      while (!stack.empty()) {
        const uint32_t t = stack.back();
        stack.pop_back();
        patch.push_back(t);
        a += area[t];
        for (int k = 0; k < 3; k++) {
          const int64_t q = nbr[t][k];
          if (q < 0 || mark[q] != tag || done.count(uint32_t(q)) || area[q] <= 0) continue;
          if (dot(normal[q], normal[s0]) < cosFlat) continue;
          bool on = true;
          for (int j = 0; j < 3 && on; j++)
            on = std::abs(dot(sub(m.vert(m.idx[3 * q + j]), m.vert(m.idx[3 * s0])),
                              normal[s0])) <= tol;
          if (!on) continue;
          done[uint32_t(q)] = 1;
          stack.push_back(uint32_t(q));
        }
      }
      patches++;
      if (a > bestArea) {
        bestArea = a;
        best = std::move(patch);
      }
    }
    // Only a patch clearly bigger than a facet strip is a real plane: peeling
    // the strips of a curved surface would turn it into flat faces.  A region
    // of only a few patches is flats meeting at a shallow angle, though, and
    // its similar-sized faces would never pass the size test.
    const double mean = patches ? totalArea / patches : 0;
    if (patches > 8 && bestArea < 3 * mean) best.clear();
    return best;
  };

  // Smooth regions (no edge sharper than the crease angle), each fitted; one
  // that fits nothing whole -- a slot's flat sides running tangentially into
  // its round ends -- has its largest coplanar patch peeled off as a plane and
  // the rest refitted, until it fits or nothing plane-sized is left.
  int64_t tag = 0;
  for (size_t seed = 0; seed < T; seed++) {
    // -1 is untouched; a grown triangle is -2 until regions are numbered.
    if (regionOf[seed] != -1) continue;
    std::vector<uint32_t> tris, stack{uint32_t(seed)};
    regionOf[seed] = -2;
    while (!stack.empty()) {
      const uint32_t t = stack.back();
      stack.pop_back();
      tris.push_back(t);
      for (int k = 0; k < 3; k++) {
        const int64_t q = nbr[t][k];
        if (q < 0 || regionOf[q] != -1) continue;
        if (area[q] > 0 && area[t] > 0 && dot(normal[q], normal[t]) < cosCrease)
          continue;
        regionOf[q] = -2;
        stack.push_back(uint32_t(q));
      }
    }
    // Peeling a plane off can leave the rest in several pieces (a slot's two
    // round ends, once its flat sides are gone), each a surface of its own, so
    // pieces queue up and each is fitted alone.
    std::vector<std::vector<uint32_t>> queue{std::move(tris)};
    int peels = 0;
    while (!queue.empty()) {
      std::vector<uint32_t> piece = std::move(queue.back());
      queue.pop_back();
      Fit f = fitRegion(piece);
      std::vector<uint32_t> patch;
      if (f.type == "mesh" && peels < 64) patch = largestCoplanarPatch(piece, tag++);
      if (patch.empty()) {
        regions.push_back({piece, f});
        continue;
      }
      peels++;
      regions.push_back({patch, FitPlane(m, RegionVerts(m, patch))});
      std::sort(patch.begin(), patch.end());
      const int64_t inRest = tag++;
      std::vector<uint32_t> rest;
      for (uint32_t t : piece)
        if (!std::binary_search(patch.begin(), patch.end(), t)) {
          rest.push_back(t);
          mark[t] = inRest;
        }
      for (uint32_t s0 : rest) {
        if (mark[s0] != inRest) continue;
        std::vector<uint32_t> part, st{s0};
        mark[s0] = -3;
        while (!st.empty()) {
          const uint32_t t = st.back();
          st.pop_back();
          part.push_back(t);
          for (int k = 0; k < 3; k++) {
            const int64_t q = nbr[t][k];
            if (q < 0 || mark[q] != inRest) continue;
            mark[q] = -3;
            st.push_back(uint32_t(q));
          }
        }
        queue.push_back(std::move(part));
      }
    }
    if ((seed & 1023) == 0 && MeshCancelRequested())
      throw std::runtime_error("recognizeSurfaces: cancelled");
  }
  for (size_t i = 0; i < regions.size(); i++)
    for (uint32_t t : regions[i].tris) regionOf[t] = int64_t(i);
  std::vector<int64_t> vertRegion(V, -1);
  for (size_t t = 0; t < T; t++)
    if (!collapsed[t])
      for (int k = 0; k < 3; k++) vertRegion[m.idx[3 * t + k]] = regionOf[t];
  for (size_t t = 0; t < T; t++) {
    if (!collapsed[t]) continue;
    int64_t r = -1;
    for (int k = 0; k < 3 && r < 0; k++) r = vertRegion[m.idx[3 * t + k]];
    if (r < 0) {
      r = int64_t(regions.size());
      regions.push_back({{}, Fit{}});
    }
    regions[r].tris.push_back(uint32_t(t));
    regionOf[t] = r;
  }

  // Report.
  std::vector<uint32_t> triRegion(T);
  for (size_t t = 0; t < T; t++) triRegion[t] = uint32_t(regionOf[t]);
  occjs::Val list = js.makeArray(uint32_t(regions.size()));
  std::unordered_map<std::string, double> counts, triCounts;
  for (size_t i = 0; i < regions.size(); i++) {
    Region& r = regions[i];
    for (uint32_t t : r.tris) r.area += area[t];
    occjs::Val o = js.makeObject();
    js.set(o, "type", js.makeString(r.fit.type));
    js.set(o, "triangles", js.makeNumber(double(r.tris.size())));
    js.set(o, "area", js.makeNumber(r.area));
    js.set(o, "deviation", js.makeNumber(r.fit.dev));
    if (r.fit.type != "mesh") {
      js.set(o, "point", js.makeFloat64Array(r.fit.point.data(), 3));
      js.set(o, "dir", js.makeFloat64Array(r.fit.dir.data(), 3));
      js.set(o, "radius", js.makeNumber(r.fit.radius));
      js.set(o, "halfAngle", js.makeNumber(r.fit.halfAngle));
    }
    js.setAt(list, uint32_t(i), o);
    counts[r.fit.type] += 1;
    triCounts[r.fit.type] += double(r.tris.size());
  }
  occjs::Val out = js.makeObject();
  js.set(out, "regions", list);
  js.set(out, "triangleRegion", js.makeUint32Array(triRegion.data(), triRegion.size()));
  occjs::Val c = js.makeObject();
  occjs::Val tc = js.makeObject();
  for (const char* type : {"plane", "cylinder", "cone", "sphere", "mesh"}) {
    js.set(c, type, js.makeNumber(counts[type]));
    js.set(tc, type, js.makeNumber(triCounts[type]));
  }
  js.set(out, "counts", c);
  js.set(out, "triangleCounts", tc);
  js.set(out, "triangles", js.makeNumber(double(T)));
  return out;
}
