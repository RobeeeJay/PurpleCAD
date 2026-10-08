// Mesh tools built on meshoptimizer.  See mesh_tools.h.

#include "mesh_tools.h"

#include <algorithm>
#include <cfloat>
#include <cmath>
#include <cstdint>
#include <exception>
#include <stdexcept>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "meshoptimizer.h"
#include <cstdio>

namespace {

struct Topology {
  uint32_t open = 0;
  uint32_t nonManifold = 0;
  uint32_t degenerate = 0;
};

inline uint64_t EdgeKey(uint32_t a, uint32_t b) {
  if (a > b) std::swap(a, b);
  return (uint64_t(a) << 32) | b;
}

// Undirected edge use counts over a welded index buffer.  Open (used once)
// means a hole; non-manifold (used three or more times) means sheets meeting
// along an edge.  A triangle that repeats a vertex after welding has zero area
// and bounds nothing, so it is counted apart and its edges ignored.
std::unordered_map<uint64_t, uint32_t> EdgeUses(const std::vector<uint32_t>& idx,
                                                uint32_t* degenerate) {
  std::unordered_map<uint64_t, uint32_t> uses;
  uses.reserve(idx.size());
  for (size_t f = 0; f + 2 < idx.size(); f += 3) {
    const uint32_t v[3] = {idx[f], idx[f + 1], idx[f + 2]};
    if (v[0] == v[1] || v[1] == v[2] || v[2] == v[0]) {
      if (degenerate) (*degenerate)++;
      continue;
    }
    for (int k = 0; k < 3; k++) uses[EdgeKey(v[k], v[(k + 1) % 3])]++;
  }
  return uses;
}

Topology CountEdges(const std::vector<uint32_t>& idx) {
  Topology t;
  for (const auto& e : EdgeUses(idx, &t.degenerate)) {
    if (e.second == 1)
      t.open++;
    else if (e.second > 2)
      t.nonManifold++;
  }
  return t;
}

// Positions arrive as doubles from the op layer; a Float32Array (straight from
// an STL) is widened.
std::vector<double> ReadPositions(occjs::Js& js, occjs::Val v, const char* op) {
  const occjs::Typed arr = js.typed(v);
  if (arr.kind == occjs::TypedKind::None)
    throw std::runtime_error(std::string(op) + ": positions must be a typed array");
  std::vector<double> pos;
  if (arr.kind == occjs::TypedKind::Float64) {
    auto p = static_cast<const double*>(arr.data);
    pos.assign(p, p + arr.length);
  } else if (arr.kind == occjs::TypedKind::Float32) {
    auto p = static_cast<const float*>(arr.data);
    pos.assign(p, p + arr.length);
  } else {
    throw std::runtime_error(std::string(op) + ": positions must be float");
  }
  return pos;
}

// No index buffer: an STL's triangle soup, three private vertices each.
std::vector<uint32_t> ReadIndices(occjs::Js& js, size_t at,
                                  size_t vertexCount, const char* op) {
  std::vector<uint32_t> idx;
  if (js.argc() > at && js.isTypedArray(js[at])) {
    auto i = js.u32(js[at]);
    idx.assign(i.Data(), i.Data() + i.ElementLength());
  } else {
    idx.resize(vertexCount);
    for (size_t i = 0; i < vertexCount; i++) idx[i] = uint32_t(i);
  }
  if (idx.size() % 3 != 0)
    throw std::runtime_error(std::string(op) + ": index count is not a multiple of 3");
  for (uint32_t i : idx)
    if (i >= vertexCount)
      throw std::runtime_error(std::string(op) + ": index out of range");
  return idx;
}

struct Welded {
  std::vector<double> pos;
  std::vector<uint32_t> idx;
  size_t before = 0;
};

// Merge vertices at exactly the same position.  The remap compares doubles
// bit-for-bit, so only EXACT duplicates merge and no point moves.
Welded Weld(std::vector<double> pos, const std::vector<uint32_t>& idx) {
  // -0.0 and 0.0 differ in their sign bit though they are the same point;
  // exporters write both.  Adding +0.0 turns -0.0 into 0.0 and leaves every
  // other value as it is.
  for (double& c : pos) c += 0.0;
  const size_t vertexCount = pos.size() / 3;
  std::vector<uint32_t> remap(vertexCount);
  const size_t unique = meshopt_generateVertexRemap(
      remap.data(), idx.data(), idx.size(), pos.data(), vertexCount,
      sizeof(double) * 3);
  Welded w;
  w.before = vertexCount;
  w.pos.resize(unique * 3);
  meshopt_remapVertexBuffer(w.pos.data(), pos.data(), vertexCount,
                            sizeof(double) * 3, remap.data());
  w.idx.resize(idx.size());
  meshopt_remapIndexBuffer(w.idx.data(), idx.data(), idx.size(), remap.data());
  return w;
}

// Distance from p to triangle abc (Ericson, Real-Time Collision Detection
// 5.1.5: closest point by Voronoi region).
double PointTriangle(const double* p, const double* a, const double* b,
                     const double* c) {
  double ab[3], ac[3], ap[3], q[3];
  for (int i = 0; i < 3; i++) {
    ab[i] = b[i] - a[i];
    ac[i] = c[i] - a[i];
    ap[i] = p[i] - a[i];
  }
  auto dot = [](const double* u, const double* v) {
    return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  };
  auto at = [&](double s, double t) {
    for (int i = 0; i < 3; i++) q[i] = a[i] + s * ab[i] + t * ac[i];
  };
  const double d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) {
    at(0, 0);
  } else {
    double bp[3], cp[3];
    for (int i = 0; i < 3; i++) {
      bp[i] = p[i] - b[i];
      cp[i] = p[i] - c[i];
    }
    const double d3 = dot(ab, bp), d4 = dot(ac, bp);
    const double d5 = dot(ab, cp), d6 = dot(ac, cp);
    const double vc = d1 * d4 - d3 * d2;
    const double vb = d5 * d2 - d1 * d6;
    const double va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) {
      at(1, 0);
    } else if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      at(d1 / (d1 - d3), 0);
    } else if (d6 >= 0 && d5 <= d6) {
      at(0, 1);
    } else if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      at(0, d2 / (d2 - d6));
    } else if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      const double w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      for (int i = 0; i < 3; i++) q[i] = b[i] + w * (c[i] - b[i]);
    } else {
      const double den = 1 / (va + vb + vc);
      at(vb * den, vc * den);
    }
  }
  double d[3] = {p[0] - q[0], p[1] - q[1], p[2] - q[2]};
  return std::sqrt(dot(d, d));
}

// Uniform grid over a triangle set, for nearest-surface queries.  A triangle
// within distance r of p overlaps the cube [p - r, p + r], so searching the
// cells of a growing cube finds the true nearest once it lies inside the cube.
class TriangleGrid {
 public:
  TriangleGrid(const std::vector<double>& pos, const std::vector<uint32_t>& idx)
      : pos_(pos), idx_(idx), stamp_(idx.size() / 3, 0) {
    for (int k = 0; k < 3; k++) {
      lo_[k] = DBL_MAX;
      hi_[k] = -DBL_MAX;
    }
    for (uint32_t v : idx)
      for (int k = 0; k < 3; k++) {
        lo_[k] = std::min(lo_[k], pos[3 * v + k]);
        hi_[k] = std::max(hi_[k], pos[3 * v + k]);
      }
    double extent = 0;
    for (int k = 0; k < 3; k++) extent = std::max(extent, hi_[k] - lo_[k]);
    const size_t tris = idx.size() / 3;
    const int per = std::max(1, std::min(128, int(std::cbrt(double(tris)) * 2)));
    cell_ = std::max(extent / per, 1e-12);
    for (int k = 0; k < 3; k++)
      n_[k] = std::max(1, std::min(256, int((hi_[k] - lo_[k]) / cell_) + 1));
    cells_.resize(size_t(n_[0]) * n_[1] * n_[2]);
    for (size_t t = 0; t < tris; t++) {
      int a[3], b[3];
      for (int k = 0; k < 3; k++) {
        double mn = DBL_MAX, mx = -DBL_MAX;
        for (int j = 0; j < 3; j++) {
          const double c = pos[3 * idx[3 * t + j] + k];
          mn = std::min(mn, c);
          mx = std::max(mx, c);
        }
        a[k] = Cell(mn, k);
        b[k] = Cell(mx, k);
      }
      for (int x = a[0]; x <= b[0]; x++)
        for (int y = a[1]; y <= b[1]; y++)
          for (int z = a[2]; z <= b[2]; z++)
            cells_[(size_t(x) * n_[1] + y) * n_[2] + z].push_back(uint32_t(t));
    }
  }

  // Distance to the nearest triangle, and which one it is (`tri`, when asked).
  // Stops growing at `cap`: past it the returned value is only known to exceed
  // cap, which is all a bound check needs.
  double Nearest(const double* p, double cap, uint32_t* tri = nullptr) {
    double best = DBL_MAX;
    for (double r = cell_;; r *= 2) {
      if (++tick_ == 0) {
        std::fill(stamp_.begin(), stamp_.end(), 0);
        tick_ = 1;
      }
      int a[3], b[3];
      bool whole = true;
      for (int k = 0; k < 3; k++) {
        a[k] = Cell(p[k] - r, k);
        b[k] = Cell(p[k] + r, k);
        if (a[k] > 0 || b[k] < n_[k] - 1) whole = false;
      }
      for (int x = a[0]; x <= b[0]; x++)
        for (int y = a[1]; y <= b[1]; y++)
          for (int z = a[2]; z <= b[2]; z++)
            for (uint32_t t : cells_[(size_t(x) * n_[1] + y) * n_[2] + z]) {
              if (stamp_[t] == tick_) continue;
              stamp_[t] = tick_;
              const uint32_t* v = &idx_[3 * t];
              const double d = PointTriangle(p, &pos_[3 * v[0]],
                                             &pos_[3 * v[1]], &pos_[3 * v[2]]);
              if (d < best) {
                best = d;
                if (tri) *tri = t;
              }
            }
      if (best <= r || whole || r >= cap) return best;
    }
  }

 private:
  int Cell(double c, int k) const {
    const int i = int(std::floor((c - lo_[k]) / cell_));
    return std::max(0, std::min(n_[k] - 1, i));
  }
  const std::vector<double>& pos_;
  const std::vector<uint32_t>& idx_;
  std::vector<std::vector<uint32_t>> cells_;
  std::vector<uint32_t> stamp_;
  uint32_t tick_ = 0;
  double lo_[3], hi_[3], cell_ = 1;
  int n_[3] = {1, 1, 1};
};

// An UPPER BOUND on how far any point of one surface lies from the other,
// measured both ways (original to simplified and back).  Sampling points is
// not enough: probing vertices, centroids and edge midpoints read 0.050 mm on
// a real part where brute-force sampling found 0.079 mm inside the triangles.
//
// Distance to one triangle is a convex function, so a patch whose three
// corners all lie within d of a single triangle of the other surface lies
// wholly within d of it.  Two more candidates cover what one triangle can't:
// a patch across the seam of two triangles is split by a plane through the
// seam and each side bounded by its own triangle, and two coplanar triangles
// forming a convex quad count as one convex piece.  A patch nothing
// certifies is halved across its longest edge, down to where the corner
// distances plus its size (every point is within longest-edge/sqrt(3) of a
// corner) bound it instead.
//
// Pieces are refined until their bound is within `target`.  Those that can't
// be report the ORIGINAL vertex that would hold them in place into `over`.
class Certifier {
 public:
  Certifier(const std::vector<double>& pos, const std::vector<uint32_t>& other,
            double target, std::vector<uint32_t>* over)
      : pos_(pos), other_(other), grid_(pos, other), target_(target),
        over_(over), quads_(other.size(), UINT32_MAX) {
    normals_.resize(other.size());
    for (size_t t = 0; t + 2 < other.size(); t += 3) {
      const double* p = &pos[3 * other[t]];
      const double* q = &pos[3 * other[t + 1]];
      const double* r = &pos[3 * other[t + 2]];
      double e1[3], e2[3];
      for (int k = 0; k < 3; k++) {
        e1[k] = q[k] - p[k];
        e2[k] = r[k] - p[k];
      }
      double* n = &normals_[t];
      n[0] = e1[1] * e2[2] - e1[2] * e2[1];
      n[1] = e1[2] * e2[0] - e1[0] * e2[2];
      n[2] = e1[0] * e2[1] - e1[1] * e2[0];
      const double l = std::sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
      if (l > 0)
        for (int k = 0; k < 3; k++) n[k] /= l;
    }
    // quads_[3 t + k]: the triangle across edge k of t, when the two are
    // coplanar and their union is a convex quad.
    std::unordered_map<uint64_t, uint32_t> firstUse;
    std::unordered_map<uint64_t, uint32_t> uses;
    for (size_t t = 0; t + 2 < other.size(); t += 3)
      for (int k = 0; k < 3; k++) {
        const uint64_t e = EdgeKey(other[t + k], other[t + (k + 1) % 3]);
        if (uses[e]++ == 0) firstUse[e] = uint32_t(t + k);
      }
    for (size_t t = 0; t + 2 < other.size(); t += 3)
      for (int k = 0; k < 3; k++) {
        const uint64_t e = EdgeKey(other[t + k], other[t + (k + 1) % 3]);
        if (uses[e] != 2) continue;
        const uint32_t slot = firstUse[e];
        if (slot / 3 == t / 3) continue;
        const uint32_t u = slot / 3;
        if (ConvexCoplanar(uint32_t(t / 3), k, u)) {
          quads_[t + k] = u;
          quads_[slot] = uint32_t(t / 3);
        }
      }
  }

  // Bound for triangle abc; `owner` is the original triangle it lies on (to
  // lock when it strays), or null when it is a simplified triangle.
  double Triangle(const double* a, const double* b, const double* c,
                  const uint32_t* owner) {
    if ((++count_ & 0x3FF) == 0 && MeshCancelRequested())
      throw std::runtime_error("cancelled");
    return Piece(At(a), At(b), At(c), owner, 0);
  }

 private:
  // A patch corner with its distance to, and nearest triangle of, the other
  // surface.  Split patches share corners with their parent and siblings, so
  // each split queries only its three new midpoints.
  struct Corner {
    double p[3];
    double d;
    uint32_t near;
  };

  Corner At(const double* p) {
    Corner c;
    for (int k = 0; k < 3; k++) c.p[k] = p[k];
    c.near = UINT32_MAX;
    c.d = grid_.Nearest(c.p, target_, &c.near);
    return c;
  }

  Corner Mid(const Corner& a, const Corner& b) {
    double m[3];
    for (int k = 0; k < 3; k++) m[k] = (a.p[k] + b.p[k]) / 2;
    return At(m);
  }

  double Piece(const Corner& a, const Corner& b, const Corner& c,
               const uint32_t* owner, int depth) {
    const double* v[3] = {a.p, b.p, c.p};
    const uint32_t near[3] = {a.near, b.near, c.near};
    const double worstCorner = std::max({a.d, b.d, c.d});
    if (worstCorner > target_) {
      const Corner& w = a.d >= b.d && a.d >= c.d ? a : b.d >= c.d ? b : c;
      return Stray(worstCorner, owner, near, w.p);
    }
    double best = DBL_MAX;
    for (int i = 0; i < 3; i++) {
      if (near[i] == UINT32_MAX || (i > 0 && near[i] == near[0]) ||
          (i > 1 && near[i] == near[1]))
        continue;
      const uint32_t t = near[i];
      double dt[3];
      double m = 0;
      for (int j = 0; j < 3; j++) m = std::max(m, dt[j] = To(v[j], t));
      best = std::min(best, m);
      for (int j = i + 1; j < 3 && best > target_; j++)
        if (near[j] != UINT32_MAX && near[j] != t)
          best = std::min(best, SplitBound(v, t, near[j]));
      for (int k = 0; k < 3 && best > target_; k++) {
        const uint32_t u = quads_[3 * t + k];
        if (u == UINT32_MAX) continue;
        double mq = 0;
        for (int j = 0; j < 3; j++)
          mq = std::max(mq, std::min(dt[j], To(v[j], u)));
        best = std::min(best, mq);
      }
    }
    if (best <= target_) return best;
    double edge = 0;
    int longest = 0;
    for (int i = 0; i < 3; i++) {
      const double* p = v[i];
      const double* q = v[(i + 1) % 3];
      const double len = std::sqrt((p[0] - q[0]) * (p[0] - q[0]) +
                                   (p[1] - q[1]) * (p[1] - q[1]) +
                                   (p[2] - q[2]) * (p[2] - q[2]));
      if (len > edge) {
        edge = len;
        longest = i;
      }
    }
    const double bound = std::min(best, worstCorner + edge / std::sqrt(3.0));
    if (bound <= target_) return bound;
    if (depth >= 48) {
      double centre[3];
      for (int k = 0; k < 3; k++) centre[k] = (a.p[k] + b.p[k] + c.p[k]) / 3;
      return Stray(bound, owner, near, centre);
    }
    // Halve the longest edge.  Splitting all three edges keeps a sliver's
    // shape, so a 50 mm sliver on a real part still had a 0.05 mm edge ten
    // levels down, too long for the size bound at 0.01 mm.
    const Corner* k[3] = {&a, &b, &c};
    const Corner& p = *k[longest];
    const Corner& q = *k[(longest + 1) % 3];
    const Corner& r = *k[(longest + 2) % 3];
    const Corner m = Mid(p, q);
    return std::max(Piece(p, m, r, owner, depth + 1),
                    Piece(m, q, r, owner, depth + 1));
  }

  // Split the patch by a plane between triangles t and u, and bound each side
  // by its own triangle.  Any split gives a true bound (each side is convex);
  // a plane through their shared edge, along their mean normal, makes it
  // tight on a curved surface, where a patch straddling the seam otherwise
  // had to be split down to the tolerance.
  double SplitBound(const double* const* v, uint32_t t, uint32_t u) const {
    const uint32_t* a = &other_[3 * t];
    const uint32_t* b = &other_[3 * u];
    uint32_t shared[2];
    int ns = 0;
    for (int i = 0; i < 3; i++)
      for (int j = 0; j < 3; j++)
        if (a[i] == b[j] && ns < 2) shared[ns++] = a[i];
    double o[3], n[3];
    if (ns == 2) {
      const double* p = &pos_[3 * shared[0]];
      const double* q = &pos_[3 * shared[1]];
      double e[3], m[3];
      const double* na = Normal(t);
      const double* nb = Normal(u);
      for (int k = 0; k < 3; k++) {
        o[k] = p[k];
        e[k] = q[k] - p[k];
        m[k] = na[k] + nb[k];
      }
      n[0] = e[1] * m[2] - e[2] * m[1];
      n[1] = e[2] * m[0] - e[0] * m[2];
      n[2] = e[0] * m[1] - e[1] * m[0];
      // Orient so t's far corner is on the negative side.
      double far[3];
      for (int i = 0; i < 3; i++)
        if (a[i] != shared[0] && a[i] != shared[1])
          for (int k = 0; k < 3; k++) far[k] = pos_[3 * a[i] + k] - o[k];
      if (far[0] * n[0] + far[1] * n[1] + far[2] * n[2] > 0)
        for (double& c : n) c = -c;
    } else {
      double ca[3] = {0, 0, 0}, cb[3] = {0, 0, 0};
      for (int i = 0; i < 3; i++)
        for (int k = 0; k < 3; k++) {
          ca[k] += pos_[3 * a[i] + k] / 3;
          cb[k] += pos_[3 * b[i] + k] / 3;
        }
      for (int k = 0; k < 3; k++) {
        o[k] = (ca[k] + cb[k]) / 2;
        n[k] = cb[k] - ca[k];
      }
    }
    double side[3];
    for (int i = 0; i < 3; i++)
      side[i] = (v[i][0] - o[0]) * n[0] + (v[i][1] - o[1]) * n[1] +
                (v[i][2] - o[2]) * n[2];
    double bound = 0;
    for (int i = 0; i < 3; i++) {
      bound = std::max(bound, To(v[i], side[i] <= 0 ? t : u));
      const int j = (i + 1) % 3;
      if ((side[i] < 0 && side[j] > 0) || (side[i] > 0 && side[j] < 0)) {
        const double f = side[i] / (side[i] - side[j]);
        double x[3];
        for (int k = 0; k < 3; k++) x[k] = v[i][k] + f * (v[j][k] - v[i][k]);
        bound = std::max(bound, std::max(To(x, t), To(x, u)));
      }
    }
    return bound;
  }

  const double* Normal(uint32_t t) const { return &normals_[3 * t]; }

  double To(const double* p, uint32_t t) const {
    const uint32_t* o = &other_[3 * t];
    return PointTriangle(p, &pos_[3 * o[0]], &pos_[3 * o[1]], &pos_[3 * o[2]]);
  }

  // Triangle u shares edge k of t: are they coplanar, and is their union
  // convex -- that is, does the diagonal between the two far corners cross
  // the shared edge?
  bool ConvexCoplanar(uint32_t t, int k, uint32_t u) const {
    const uint32_t* a = &other_[3 * t];
    const uint32_t p = a[k], q = a[(k + 1) % 3], r = a[(k + 2) % 3];
    const uint32_t* b = &other_[3 * u];
    uint32_t s = UINT32_MAX;
    for (int j = 0; j < 3; j++)
      if (b[j] != p && b[j] != q) s = b[j];
    if (s == UINT32_MAX) return false;
    auto P = [&](uint32_t i) { return &pos_[3 * i]; };
    auto sub = [](const double* x, const double* y, double* o) {
      for (int i = 0; i < 3; i++) o[i] = x[i] - y[i];
    };
    auto cross = [](const double* x, const double* y, double* o) {
      o[0] = x[1] * y[2] - x[2] * y[1];
      o[1] = x[2] * y[0] - x[0] * y[2];
      o[2] = x[0] * y[1] - x[1] * y[0];
    };
    auto dot = [](const double* x, const double* y) {
      return x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    };
    double pq[3], pr[3], ps[3], n[3];
    sub(P(q), P(p), pq);
    sub(P(r), P(p), pr);
    sub(P(s), P(p), ps);
    cross(pq, pr, n);
    const double nn = std::sqrt(dot(n, n));
    const double len = std::sqrt(dot(pq, pq));
    if (nn == 0 || len == 0) return false;
    // Coplanar: s lies on t's plane, to a hair of the edge length.
    if (std::fabs(dot(n, ps)) / nn > 1e-9 * len) return false;
    // Convex: r and s straddle line pq, and p and q straddle line rs.
    double c1[3], c2[3], rs[3], rp[3], rq[3];
    cross(pq, pr, c1);
    cross(pq, ps, c2);
    if (dot(c1, n) * dot(c2, n) >= 0) return false;
    sub(P(s), P(r), rs);
    sub(P(p), P(r), rp);
    sub(P(q), P(r), rq);
    cross(rs, rp, c1);
    cross(rs, rq, c2);
    return dot(c1, n) * dot(c2, n) < 0;
  }

  // Hold the one original vertex closest to the stray point: of the original
  // triangle the patch lies on, or of the original triangles nearest it.
  // Locking whole triangles held the bound too, but kept half as many
  // triangles again as needed (25% fewer at 0.2 mm on a real part, where one
  // vertex at a time gave far more).
  double Stray(double bound, const uint32_t* owner, const uint32_t* near,
               const double* at) {
    if (!over_) return bound;
    uint32_t pick = UINT32_MAX;
    double best = DBL_MAX;
    auto consider = [&](uint32_t v) {
      const double* q = &pos_[3 * v];
      const double d = (q[0] - at[0]) * (q[0] - at[0]) +
                       (q[1] - at[1]) * (q[1] - at[1]) +
                       (q[2] - at[2]) * (q[2] - at[2]);
      if (d < best) {
        best = d;
        pick = v;
      }
    };
    if (owner) {
      for (int i = 0; i < 3; i++) consider(owner[i]);
    } else {
      for (int i = 0; i < 3; i++)
        if (near[i] != UINT32_MAX)
          for (int j = 0; j < 3; j++) consider(other_[3 * near[i] + j]);
    }
    if (pick != UINT32_MAX) over_->push_back(pick);
    return bound;
  }

  const std::vector<double>& pos_;
  const std::vector<uint32_t>& other_;
  TriangleGrid grid_;
  double target_;
  std::vector<uint32_t>* over_;
  std::vector<uint32_t> quads_;
  std::vector<double> normals_;
  uint32_t count_ = 0;
};

// Runs across threads: each takes a share of the triangles with its own
// Certifier (its grid holds per-query scratch).  Pure geometry on arrays the
// threads only read -- no OCC state -- so it is safe inside the OCC worker.
double BoundDeviation(const std::vector<double>& pos,
                      const std::vector<uint32_t>& original,
                      const std::vector<uint32_t>& simplified, double target,
                      std::vector<uint32_t>* over) {
  const unsigned threads =
      std::max(1u, std::min(8u, std::thread::hardware_concurrency()));
  std::vector<double> worst(threads, 0);
  std::vector<std::vector<uint32_t>> strays(threads);
  std::vector<std::exception_ptr> failed(threads);
  auto run = [&](unsigned k) {
    try {
      std::vector<uint32_t>* mine = over ? &strays[k] : nullptr;
      {
        Certifier onto(pos, simplified, target, mine);
        for (size_t t = 3 * k; t + 2 < original.size(); t += 3 * threads)
          worst[k] = std::max(worst[k], onto.Triangle(&pos[3 * original[t]],
                                                      &pos[3 * original[t + 1]],
                                                      &pos[3 * original[t + 2]],
                                                      &original[t]));
      }
      Certifier back(pos, original, target, mine);
      for (size_t t = 3 * k; t + 2 < simplified.size(); t += 3 * threads)
        worst[k] = std::max(worst[k], back.Triangle(&pos[3 * simplified[t]],
                                                    &pos[3 * simplified[t + 1]],
                                                    &pos[3 * simplified[t + 2]],
                                                    nullptr));
    } catch (...) {
      failed[k] = std::current_exception();
    }
  };
  std::vector<std::thread> pool;
  for (unsigned k = 1; k < threads; k++) pool.emplace_back(run, k);
  run(0);
  for (auto& t : pool) t.join();
  for (auto& f : failed)
    if (f) std::rethrow_exception(f);
  if (over)
    for (auto& s : strays) over->insert(over->end(), s.begin(), s.end());
  return *std::max_element(worst.begin(), worst.end());
}

}  // namespace

occjs::Val WeldMesh(occjs::Js& js) {
  if (js.argc() < 1)
    throw std::runtime_error("weldMesh: positions must be a typed array");
  std::vector<double> pos = ReadPositions(js, js[0], "weldMesh");
  const size_t vertexCount = pos.size() / 3;
  if (vertexCount < 3) throw std::runtime_error("weldMesh: too few vertices");
  const std::vector<uint32_t> idx = ReadIndices(js, 1, vertexCount, "weldMesh");

  const Welded w = Weld(std::move(pos), idx);
  const Topology topo = CountEdges(w.idx);

  occjs::Val out = js.makeObject();
  js.set(out, "positions", js.makeFloat64Array(w.pos.data(), w.pos.size()));
  js.set(out, "indices", js.makeUint32Array(w.idx.data(), w.idx.size()));
  js.set(out, "openEdges", double(topo.open));
  js.set(out, "nonManifoldEdges", double(topo.nonManifold));
  js.set(out, "degenerateTriangles", double(topo.degenerate));
  js.set(out, "verticesBefore", double(w.before));
  js.set(out, "verticesAfter", double(w.pos.size() / 3));
  return out;
}

occjs::Val SimplifyMesh(occjs::Js& js) {
  if (js.argc() < 4)
    throw std::runtime_error("simplifyMesh: expected positions, indices, mode, value");
  std::vector<double> pos = ReadPositions(js, js[0], "simplifyMesh");
  const size_t vertexCount = pos.size() / 3;
  if (vertexCount < 3) throw std::runtime_error("simplifyMesh: too few vertices");
  const std::vector<uint32_t> idx = ReadIndices(js, 1, vertexCount, "simplifyMesh");
  const std::string mode = js.string(js[2]);
  const double value = js.number(js[3]);
  const bool byError = mode == "deviation";
  if (!byError && mode != "triangles")
    throw std::runtime_error("simplifyMesh: mode must be deviation or triangles");
  if (!(value > 0)) throw std::runtime_error("simplifyMesh: value must be positive");

  // Simplify the WELDED mesh: on a soup no two triangles share a vertex, so
  // there is nothing to collapse.  An OCC tessellation shares positions
  // along face seams without sharing vertices -- welding joins those too.
  const Welded w = Weld(std::move(pos), idx);
  const size_t nv = w.pos.size() / 3;
  const Topology before = CountEdges(w.idx);
  std::unordered_set<uint64_t> nonManifoldBefore;
  for (const auto& e : EdgeUses(w.idx, nullptr))
    if (e.second > 2) nonManifoldBefore.insert(e.first);

  std::vector<float> fpos(w.pos.begin(), w.pos.end());
  std::vector<std::vector<uint32_t>> ring(nv);
  for (size_t t = 0; t + 2 < w.idx.size(); t += 3)
    for (int a = 0; a < 3; a++)
      for (int b = 0; b < 3; b++)
        if (a != b) ring[w.idx[t + a]].push_back(w.idx[t + b]);

  // An open mesh keeps its border where it is: collapsing border edges
  // would move the hole, not simplify the surface.
  const unsigned options = meshopt_SimplifyErrorAbsolute |
                           (before.open ? meshopt_SimplifyLockBorder : 0);
  const size_t targetIndices =
      byError ? 0 : std::min(w.idx.size(), size_t(value) * 3);
  // A collapse can close a thin gap and pinch two sheets of the surface
  // together along one edge (four triangles on it, two each way).  Lock the
  // vertices around each new pinch and simplify again; two rounds cleared
  // every pinch on a real part, for 4% more triangles.  Locks accumulate
  // across calls, so a lock placed for the deviation (below) stays.
  std::vector<unsigned char> lock(nv, 0);
  auto simplify = [&](float targetError, std::vector<uint32_t>& out) {
    for (int round = 0; round < 8; round++) {
      if (MeshCancelRequested()) throw std::runtime_error("cancelled");
      out.assign(w.idx.size(), 0);
      const size_t n = meshopt_simplifyWithAttributes(
          out.data(), w.idx.data(), w.idx.size(), fpos.data(), nv,
          sizeof(float) * 3, nullptr, 0, nullptr, 0, lock.data(),
          targetIndices, targetError, options, nullptr);
      out.resize(n);
      bool pinched = false;
      for (const auto& e : EdgeUses(out, nullptr)) {
        if (e.second <= 2 || nonManifoldBefore.count(e.first)) continue;
        pinched = true;
        for (uint32_t v : {uint32_t(e.first >> 32), uint32_t(e.first)}) {
          lock[v] = 1;
          for (uint32_t u : ring[v]) lock[u] = 1;
        }
      }
      if (!pinched) return;
    }
    throw std::runtime_error(
        "Simplifying would join separate parts of the surface; try a smaller reduction.");
  };

  std::vector<uint32_t> out;
  double deviation = 0;
  int attempts = 0;
  if (!byError) {
    attempts = 1;
    simplify(FLT_MAX, out);
    // No bound was asked for, so find the smallest one that certifies:
    // bisect between zero and a first loose bound, to within 2%.
    std::vector<uint32_t> over;
    double fits = BoundDeviation(w.pos, w.idx, out, DBL_MAX, nullptr);
    double fails = 0;
    while (fits > 0 && fits - fails > 0.02 * fits) {
      const double t = (fits + fails) / 2;
      over.clear();
      const double d = BoundDeviation(w.pos, w.idx, out, t, &over);
      if (over.empty())
        fits = std::min(t, d);
      else
        fails = t;
    }
    deviation = fits;
  } else {
    // meshoptimizer's error is its own estimate, not a bound: measured on a
    // real part it ran to about three times the request.  So the bound is
    // enforced by measuring the result, and where it is exceeded the
    // original vertices there are locked and the simplify runs again.
    // Tightening the request for the whole mesh instead left most of the
    // reduction on the table (9% fewer triangles at 0.05 mm, against 20% or
    // more when only the few offending spots are held).
    std::vector<uint32_t> over;
    for (;; attempts++) {
      if (attempts >= 24)
        throw std::runtime_error(
            "Couldn't simplify within that deviation; try a larger one.");
      // Asked for exactly the tolerance.  Asking for more and letting the
      // locks hold what strays sounded like more reduction but measured as
      // less (at 0.2 mm, 64-78% of the triangles kept against 50%): more of
      // the surface strays, and the locks pile up.
      simplify(float(value), out);
      over.clear();
      deviation = BoundDeviation(w.pos, w.idx, out, value, &over);
      if (over.empty()) break;
      // Holding just the offending vertex usually settles a spot within a
      // few rounds.  Where it doesn't -- the vertex is already held and the
      // patch still strays, so another collapse nearby is to blame -- hold
      // everything within two edges of it.
      bool fresh = false;
      for (uint32_t v : over) fresh |= !lock[v];
      for (uint32_t v : over) {
        lock[v] = 1;
        if (!fresh)
          for (uint32_t u : ring[v]) {
            lock[u] = 1;
            for (uint32_t x : ring[u]) lock[x] = 1;
          }
      }
    }
    attempts++;
  }

  const Topology after = CountEdges(out);
  if (after.open > before.open)
    throw std::runtime_error("Simplifying opened holes in the mesh.");

  // Keep only the vertices the simplified triangles use.
  std::vector<uint32_t> remap(nv, UINT32_MAX);
  std::vector<double> outPos;
  for (uint32_t& v : out) {
    if (remap[v] == UINT32_MAX) {
      remap[v] = uint32_t(outPos.size() / 3);
      outPos.insert(outPos.end(), &w.pos[3 * v], &w.pos[3 * v] + 3);
    }
    v = remap[v];
  }

  occjs::Val res = js.makeObject();
  js.set(res, "positions", js.makeFloat64Array(outPos.data(), outPos.size()));
  js.set(res, "indices", js.makeUint32Array(out.data(), out.size()));
  js.set(res, "trianglesBefore", double(w.idx.size() / 3));
  js.set(res, "trianglesAfter", double(out.size() / 3));
  js.set(res, "maxDeviation", deviation);
  js.set(res, "openEdges", double(after.open));
  js.set(res, "nonManifoldEdges", double(after.nonManifold));
  js.set(res, "attempts", double(attempts));
  return res;
}
