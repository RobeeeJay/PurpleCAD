// Recognising exact surfaces in a triangle mesh: which regions of an STL are
// really planes, cylinders, cones, spheres or tori, within a tolerance
// (docs/exact-imports-plan.md, Part Two).  The fits are in mesh_fit.cpp; this
// is the segmentation that decides which facets go together, and the op that
// reports it.  mesh_rebuild.cpp builds faces from the result.
//
// OCC's ShapeAnalysis_CanonicalRecognition was tried first and rejects a
// shell of flat triangle faces outright (status 1 at every tolerance), so the
// fitting is our own.

#include "mesh_recognize.h"

#include <algorithm>
#include <functional>
#include <map>
#include <queue>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

#include "mesh_freeform.h"
#include "mesh_tools.h"

using namespace recog;

namespace {

// A region this small is checked against the mesh's own chord tolerance.
constexpr size_t kWellSupported = 32;

// One segmentation.  `sagCap` is the most a region of fewer than
// kWellSupported facets may sag (see Recognize).
Recognition RecognizePass(std::vector<double> pos, const std::vector<uint32_t>& idx,
                          double tol, double creaseDeg, double flatDeg, double sagCap) {
  const size_t inputTris = (idx.empty() ? pos.size() / 3 : idx.size()) / 3;
  if (inputTris > kMaxSurfaceTriangles)
    throw std::runtime_error("too many triangles to convert (" + std::to_string(inputTris) +
                             "; the limit is " + std::to_string(kMaxSurfaceTriangles) + ")");
  const double cosCrease = std::cos(creaseDeg * M_PI / 180);
  const double cosFlat = std::cos(flatDeg * M_PI / 180);


  Welded w = Weld(std::move(pos), idx);
  Mesh m{std::move(w.pos), std::move(w.idx)};
  const size_t T = m.tris();
  const size_t V = m.pos.size() / 3;

  std::vector<V3> normal(T), centroid(T);
  std::vector<double> area(T);
  // A facet narrower than the tolerance has no normal worth checking against
  // a plane: its vertices may each sit anywhere within the tolerance, and a
  // 0.001-high sliver of a flat annulus, tilted 2.4 degrees by float noise
  // alone, refused the plane its whole region lay within 0.001 of (four on
  // a bed arm, which a near-flat cone round its own apex then took, and the
  // rebuild put back to 699 triangles).  A fillet's strips, which the normal
  // check is there to keep off planes, are many tolerances wide.
  std::vector<char> narrow(T, 0);
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
    narrow[t] = longest == 0 || 2 * area[t] / longest < tol;
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
  // Every facet faces along the plane's normal.  Near a line, a thin facet is
  // within the tolerance of a plane at almost any tilt (a fillet's facets
  // came back as hundreds of planes), so position alone can't say a facet
  // is flat on a plane.
  auto facesPlane = [&](const Fit& f, const std::vector<uint32_t>& tris) {
    for (uint32_t t : tris)
      if (area[t] > 0 && !narrow[t] && std::abs(dot(normal[t], f.dir)) < cosFlat) return false;
    return true;
  };
  // An "ellipse" whose axes differ by no more than the tolerance is a circle
  // the cylinder fit missed (its centre comes from the facets' normals, the
  // ellipse's from the vertices): it is taken as that cylinder.
  auto ovalOrRound = [&](Fit e, const std::vector<uint32_t>& vs) {
    if (e.type != "ellipticCylinder" || e.radius - e.minorRadius > tol) return e;
    e.type = "cylinder";
    e.radius = (e.radius + e.minorRadius) / 2;
    e.minorRadius = 0;
    e.dev = 0;
    for (uint32_t v : vs) e.dev = std::max(e.dev, Distance(e, m.vert(v)));
    return e;
  };
  auto fitRegion = [&](const std::vector<uint32_t>& tris) {
    const auto vs = RegionVerts(m, tris);
    const Fit plane = FitPlane(m, vs);
    if (plane.dev <= tol && facesPlane(plane, tris)) return plane;
    // A cylinder has five parameters and a cone six: through a handful of
    // vertices one always passes exactly (a 4-triangle fan on a printed tower
    // "fitted" a sphere to 1e-15), so a curved fit needs points to spare.
    if (vs.size() < 10) {
      Fit f;
      f.dev = plane.dev;
      return f;
    }
    const Fit rev = FitRevolved(m, tris, normal, centroid, area, vs, tol);
    if (rev.dev <= tol) return rev;
    const Fit sph = FitSphere(m, tris, normal, centroid, area, vs);
    if (sph.dev <= tol) return sph;
    // An oval wall and a torus have seven parameters each; they get more
    // points to spare too.
    const Fit ell = vs.size() >= 14 ? ovalOrRound(FitEllipticCylinder(m, tris, normal, area, vs), vs) : Fit{};
    if (ell.type != "mesh" && ell.dev <= tol) return ell;
    const Fit tor = vs.size() >= 14 ? FitTorus(m, tris, normal, centroid, area, vs) : Fit{};
    if (tor.type == "torus" && tor.dev <= tol) return tor;
    Fit f;  // stays triangles; remember how near the nearest fit came
    f.dev = std::min({plane.dev, rev.dev, sph.dev,
                      ell.type != "mesh" ? ell.dev : 1e300,
                      tor.type == "torus" ? tor.dev : 1e300});
    return f;
  };

  // Every kind of surface the facets fit within `tol` (same point budgets as
  // fitRegion), simplest first, and a refit of one kind on new facets.
  auto fitsOn = [&](const std::vector<uint32_t>& tris) {
    std::vector<Fit> out;
    const auto vs = RegionVerts(m, tris);
    const Fit plane = FitPlane(m, vs);
    if (plane.dev <= tol && facesPlane(plane, tris)) out.push_back(plane);
    if (vs.size() < 10) return out;
    const Fit rev = FitRevolved(m, tris, normal, centroid, area, vs, tol);
    if (rev.dev <= tol) out.push_back(rev);
    const Fit sph = FitSphere(m, tris, normal, centroid, area, vs);
    if (sph.dev <= tol) out.push_back(sph);
    if (vs.size() >= 14) {
      const Fit ell = ovalOrRound(FitEllipticCylinder(m, tris, normal, area, vs), vs);
      if (ell.type != "mesh" && ell.dev <= tol) out.push_back(ell);
      const Fit tor = FitTorus(m, tris, normal, centroid, area, vs);
      if (tor.type == "torus" && tor.dev <= tol) out.push_back(tor);
    }
    return out;
  };
  auto refit = [&](const std::string& type, const std::vector<uint32_t>& tris) {
    const auto vs = RegionVerts(m, tris);
    if (type == "plane") return FitPlane(m, vs);
    if (type == "sphere") return FitSphere(m, tris, normal, centroid, area, vs);
    if (type == "torus") return FitTorus(m, tris, normal, centroid, area, vs);
    if (type == "ellipticCylinder")
      return ovalOrRound(FitEllipticCylinder(m, tris, normal, area, vs), vs);
    return FitRevolved(m, tris, normal, centroid, area, vs, tol);
  };

  std::vector<int64_t> mark(T, -1);
  int64_t tag = 0;

  // A smooth region that is several curved surfaces running tangentially into
  // one another -- a cable tie's straight runs and bends, a fillet chain --
  // fits nothing whole.  Grow surfaces through it instead: fit a small patch round the largest unclaimed facet, take in
  // the neighbours whose vertices lie on that surface, refit on what was
  // taken, and repeat until it stops growing.  What no surface takes stays
  // triangles.
  std::vector<int64_t> seen(T, -1);
  std::vector<uint32_t> valence(m.pos.size() / 3, 0);
  for (uint32_t v : m.idx) valence[v]++;
  // On the surface: every vertex within the tolerance, and the facet's middle
  // within `budget` -- a facet of the surface itself is off it there by its
  // chord's sag, but a cap meshed with every vertex on its rim is wholly off
  // it while its vertices sit on it.
  auto onSurface = [&](const Fit& f, uint32_t t, double budget) {
    // A plane also wants the facet facing its way (facesPlane).
    if (f.type == "plane" && area[t] > 0 && !narrow[t] && std::abs(dot(normal[t], f.dir)) < cosFlat)
      return false;
    for (int k = 0; k < 3; k++)
      if (Distance(f, m.vert(m.idx[3 * t + k])) > tol) return false;
    return Distance(f, centroid[t]) <= budget;
  };
  // Twice the sag the facets a surface was fitted to show, as the budget for
  // the facets it grows into.
  auto sagBudget = [&](const Fit& f, const std::vector<uint32_t>& tris) {
    double sag = 0;
    for (uint32_t t : tris) sag = std::max(sag, Distance(f, centroid[t]));
    return 2 * sag + tol;
  };
  // A curved fit whose facets sag unevenly isn't that surface.  An exporter
  // meshes every surface to one chord tolerance, so a surface's facets sag
  // alike; a flat wall with vertices only at its ends, fitted together with
  // the start of the fillet above it, holds every vertex within the
  // tolerance on a big shallow cylinder or cone, while its long facets sit
  // up to 0.86 off it and the fillet's 0.0005.  Rebuilt, that face bulged
  // where the mesh was flat.  Of the corpus's 3,291 cylinders and cones, 53
  // had a facet sagging more than five tolerances; 48 of them more than ten
  // times their median, every one a strip of this kind.
  //
  // Nor is one whose facet sags further than a chord across half the crease
  // angle of it could: a facet spanning more of a surface than that would
  // have met its neighbours at a crease.  Facets of a long block's flat sides
  // and its corner fillets, every vertex within the tolerance of one torus,
  // sat 0.2 to 2.3 off it where this allows 0.016.
  const double creaseSag = 1 - std::cos(creaseDeg * M_PI / 360);
  // Nor is a near-flat cone round its own apex: every hilltop of a smooth
  // freeform surface fits one, within the tolerance, and a face can't hold a
  // cone's apex inside it (37 of them on a test surface came out a quarter
  // of their area).  A pointed cone keeps its apex on its boundary, and a
  // steep one is left alone.
  auto aroundApex = [&](const Fit& f, const std::vector<uint32_t>& tris) {
    if (f.type != "cone" || std::abs(f.halfAngle) < M_PI / 3) return false;
    const double apex = -f.radius / std::tan(f.halfAngle);
    const V3 u = unit(std::abs(f.dir[0]) < 0.9 ? cross(f.dir, {1, 0, 0}) : cross(f.dir, {0, 1, 0}));
    const V3 w = cross(f.dir, u);
    double tmin = 1e300, tmax = -1e300, rmax = 0;
    std::vector<double> ang;
    for (uint32_t v : RegionVerts(m, tris)) {
      const V3 d = sub(m.vert(v), f.point);
      const double t = dot(d, f.dir);
      const V3 radial = sub(d, mul(f.dir, t));
      tmin = std::min(tmin, t);
      tmax = std::max(tmax, t);
      rmax = std::max(rmax, len(radial));
      ang.push_back(std::atan2(dot(radial, w), dot(radial, u)));
    }
    const double slack = tol + 0.01 * rmax;
    if (apex < tmin - slack || apex > tmax + slack || ang.size() < 3) return false;
    std::sort(ang.begin(), ang.end());
    double gap = ang.front() + 2 * M_PI - ang.back();
    for (size_t i = 1; i < ang.size(); i++) gap = std::max(gap, ang[i] - ang[i - 1]);
    return gap < M_PI / 2;
  };
  auto unevenSag = [&](const Fit& f, const std::vector<uint32_t>& tris) {
    if (f.type == "plane" || f.type == "mesh" || tris.empty()) return false;
    if (aroundApex(f, tris)) return true;
    std::vector<double> sag;
    for (uint32_t t : tris) {
      sag.push_back(Distance(f, centroid[t]));
      const double rho = TightestRadius(f, centroid[t]);
      if (rho > 0 && sag.back() > rho * creaseSag + tol) return true;
      if (tris.size() < kWellSupported && sag.back() > sagCap) return true;
    }
    std::sort(sag.begin(), sag.end());
    return sag.back() > 5 * tol && sag.back() > 10 * sag[sag.size() / 2];
  };
  auto growSurfaces = [&](const std::vector<uint32_t>& piece) {
    const int64_t open = tag++;
    for (uint32_t t : piece) mark[t] = open;
    std::vector<uint32_t> order(piece);
    std::sort(order.begin(), order.end(),
              [&](uint32_t a, uint32_t b) { return area[a] > area[b]; });
    // Breadth-first from s0 over open facets that pass `take`, at most `cap`.
    auto reach = [&](uint32_t s0, size_t cap, auto take) {
      const int64_t stamp = tag++;
      std::vector<uint32_t> out{s0};
      seen[s0] = stamp;
      for (size_t head = 0; head < out.size() && out.size() < cap; head++)
        for (int k = 0; k < 3 && out.size() < cap; k++) {
          const int64_t q = nbr[out[head]][k];
          if (q < 0 || mark[q] != open || seen[q] == stamp || !take(uint32_t(q)))
            continue;
          seen[q] = stamp;
          out.push_back(uint32_t(q));
        }
      return out;
    };
    // The `cap` open facets nearest s0, by centre, connected to it.  Nearest
    // rather than breadth-first: from a long strip of a cylinder's side,
    // breadth-first reaches the fillet at the strip's end before enough of
    // the side, and the patch then fits neither.
    auto seedPatch = [&](uint32_t s0, size_t cap) {
      const int64_t stamp = tag++;
      using Item = std::pair<double, uint32_t>;
      std::priority_queue<Item, std::vector<Item>, std::greater<Item>> heap;
      std::vector<uint32_t> out;
      heap.push({0, s0});
      seen[s0] = stamp;
      while (!heap.empty() && out.size() < cap) {
        const uint32_t t = heap.top().second;
        heap.pop();
        out.push_back(t);
        for (int k = 0; k < 3; k++) {
          const int64_t q = nbr[t][k];
          if (q < 0 || mark[q] != open || seen[q] == stamp) continue;
          seen[q] = stamp;
          heap.push({len(sub(centroid[q], centroid[s0])), uint32_t(q)});
        }
      }
      return out;
    };
    // Grow from s0 every fit `fitsFor` offers for a seed patch, each refitted
    // as it grows until it stops, into `out`; `pick` then chooses.  The
    // simplest wins unless a more complex one takes over a quarter more
    // facets: a cone has the slack to take a cylinder and a strip of the
    // fillet beside it, and a patch of a torus also fits a sphere.
    using Grown = std::pair<Fit, std::vector<uint32_t>>;
    auto grow = [&](uint32_t s0, const std::vector<uint32_t>& patch, auto fitsFor,
                    std::vector<Grown>& out) {
      for (Fit c : fitsFor(patch)) {
        std::vector<uint32_t> mine;
        auto growAs = [&](double budget) {
          size_t last = 0;
          for (int round = 0; round < 8; round++) {
            mine = reach(s0, SIZE_MAX, [&](uint32_t q) { return onSurface(c, q, budget); });
            if (mine.size() == last) break;
            last = mine.size();
            const Fit g = refit(c.type == "cone" ? "cylinder" : c.type, mine);
            if (g.dev > tol) break;
            c = g;
          }
          mine = reach(s0, SIZE_MAX, [&](uint32_t q) { return onSurface(c, q, budget); });
        };
        growAs(sagBudget(c, patch));
        out.push_back({c, std::move(mine)});
      }
    };
    // The simplest of the grown surfaces, unless a more complex one took over
    // a quarter more facets.
    auto pick = [&](std::vector<Grown>& grown) {
      auto rank = [](const std::string& t) {
        return t == "plane"              ? 0
               : t == "cylinder"         ? 1
               : t == "cone"             ? 2
               : t == "sphere"           ? 3
               : t == "ellipticCylinder" ? 4
                                         : 5;
      };
      std::stable_sort(grown.begin(), grown.end(), [&](const Grown& a, const Grown& b) {
        const int ra = rank(a.first.type), rb = rank(b.first.type);
        return ra != rb ? ra < rb : a.second.size() > b.second.size();
      });
      Grown best;
      for (Grown& g : grown)
        if (best.second.empty() || g.second.size() * 4 > best.second.size() * 5)
          best = std::move(g);
      return best;
    };
    // Whether a set of facets surrounds at least one vertex completely.  The
    // strips of a curved surface never do -- every vertex of a strip is on
    // its edge -- however many of them happen to be coplanar; a real flat of
    // any size beyond a rectangle does.
    auto hasInteriorVertex = [&](const std::vector<uint32_t>& got) {
      std::unordered_map<uint32_t, uint32_t> inside;
      for (uint32_t t : got)
        for (int k = 0; k < 3; k++) inside[m.idx[3 * t + k]]++;
      for (auto [v, n] : inside)
        if (n == valence[v]) return true;
      return false;
    };
    auto claim = [&](const Fit& f, const std::vector<uint32_t>& got) {
      for (uint32_t t : got) mark[t] = -3;
      regions.push_back({got, f});
    };
    auto planeOnly = [&](const std::vector<uint32_t>& patch) {
      std::vector<Fit> out;
      const Fit p = FitPlane(m, RegionVerts(m, patch));
      if (!facesPlane(p, patch)) return out;
      if (p.dev <= tol) out.push_back(p);
      return out;
    };
    auto curvedOnly = [&](const std::vector<uint32_t>& patch) {
      std::vector<Fit> out;
      for (const Fit& c : fitsOn(patch))
        if (c.type != "plane") out.push_back(c);
      return out;
    };
    // Three passes, because a seed patch that straddles two surfaces fits
    // neither: flats with an interior vertex first, so a disc's big facets don't seed patches that run
    // into the fillet round it; then curved surfaces from compact patches,
    // shrinking until one fits; then whatever flats are left, two-facet
    // rectangles included.
    for (uint32_t s0 : order) {
      if (mark[s0] != open) continue;
      std::vector<Grown> grown;
      grow(s0, std::vector<uint32_t>{s0}, planeOnly, grown);
      auto [f, got] = pick(grown);
      if (got.size() >= 3 && hasInteriorVertex(got)) {
        claim(f, got);
      }
    }
    for (uint32_t s0 : order) {
      if (mark[s0] != open) continue;
      // From 128: a torus needs a long enough arc of its centre circle to place
      // it, and on a quarter of a fillet a 64-facet patch still fits a cone.
      // Every seed size is tried and the choice made across all of them: the
      // largest patch can span a slot's whole round end and the flat sides
      // beside it, which only a torus fits (its rectangles have vertices only
      // at their corners, so nothing contradicts it), while a smaller one
      // finds the cylinder the end really is.
      std::vector<Grown> grown;
      size_t tried = SIZE_MAX;
      for (size_t cap : {128, 64, 32, 16, 8}) {
        // A piece smaller than the cap gives the same patch again.
        if (cap >= tried) continue;
        const std::vector<uint32_t> patch = seedPatch(s0, cap);
        tried = patch.size();
        grow(s0, patch, curvedOnly, grown);
      }
      grown.erase(std::remove_if(grown.begin(), grown.end(),
                                 [&](const Grown& g) { return unevenSag(g.first, g.second); }),
                  grown.end());
      auto [f, got] = pick(grown);
      if (got.size() >= 4) {
        // The simplest surface that still holds everything grown: a disc
        // meshed with no inner vertex escapes the flat pass and is then
        // "fitted" by a cone 88 degrees from its axis.
        const Fit plane = FitPlane(m, RegionVerts(m, got));
        if (plane.dev <= tol && facesPlane(plane, got)) f = plane;
        claim(f, got);
      }
    }
    std::vector<uint32_t> leftover;
    for (uint32_t s0 : order) {
      if (mark[s0] != open) continue;
      std::vector<Grown> grown;
      grow(s0, std::vector<uint32_t>{s0}, planeOnly, grown);
      auto [f, got] = pick(grown);
      if (got.size() >= 2) {
        claim(f, got);
      }
      else {
        leftover.push_back(s0);
        mark[s0] = -3;
      }
    }
    // The leftovers, in connected groups, stay triangles.
    const int64_t left = tag++;
    for (uint32_t t : leftover) mark[t] = left;
    for (uint32_t s0 : leftover) {
      if (mark[s0] != left) continue;
      std::vector<uint32_t> part, st{s0};
      mark[s0] = -3;
      while (!st.empty()) {
        const uint32_t t = st.back();
        st.pop_back();
        part.push_back(t);
        for (int k = 0; k < 3; k++) {
          const int64_t q = nbr[t][k];
          if (q < 0 || mark[q] != left) continue;
          mark[q] = -3;
          st.push_back(uint32_t(q));
        }
      }
      Fit f;
      f.dev = fitRegion(part).dev;
      regions.push_back({part, f});
    }
  };

  // Smooth regions (no edge sharper than the crease angle), each fitted whole
  // if it can be, and grown through surface by surface if not.
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
    const Fit f = fitRegion(tris);
    if (f.type == "mesh" || unevenSag(f, tris))
      growSurfaces(tris);
    else
      regions.push_back({tris, f});
    if ((seed & 1023) == 0 && MeshCancelRequested())
      throw std::runtime_error("recognizeSurfaces: cancelled");
  }
  for (size_t i = 0; i < regions.size(); i++)
    for (uint32_t t : regions[i].tris) regionOf[t] = int64_t(i);

  // Neighbouring regions on one surface become one: a cylinder grown in
  // strips, or a strip of fillet claimed by a cone.  A set's surface is its
  // largest member's, and a smaller set joins only if all its vertices lie
  // within the tolerance of it -- so every merged region still fits.
  {
    std::vector<size_t> parent(regions.size());
    for (size_t i = 0; i < parent.size(); i++) parent[i] = i;
    std::function<size_t(size_t)> find = [&](size_t i) {
      return parent[i] == i ? i : parent[i] = find(parent[i]);
    };
    std::vector<std::vector<uint32_t>> verts(regions.size());
    for (size_t i = 0; i < regions.size(); i++) verts[i] = RegionVerts(m, regions[i].tris);
    std::vector<std::pair<size_t, size_t>> pairs;
    for (size_t t = 0; t < T; t++) {
      if (regionOf[t] < 0) continue;
      for (int k = 0; k < 3; k++) {
        const int64_t q = nbr[t][k];
        if (q < 0 || regionOf[q] < 0 || regionOf[q] <= regionOf[t]) continue;
        pairs.push_back({size_t(regionOf[t]), size_t(regionOf[q])});
      }
    }
    std::sort(pairs.begin(), pairs.end());
    pairs.erase(std::unique(pairs.begin(), pairs.end()), pairs.end());
    for (auto [a0, b0] : pairs) {
      size_t a = find(a0), b = find(b0);
      if (a == b) continue;
      if (regions[a].tris.size() < regions[b].tris.size()) std::swap(a, b);
      // Any kind joins a larger neighbour whose surface it lies on: a
      // fillet's edge rows are claimed early as near-flat cones, before the
      // torus they belong to is found.  Triangles join only triangles.
      if ((regions[a].fit.type == "mesh") != (regions[b].fit.type == "mesh")) continue;
      const Fit& f = regions[a].fit;
      bool fits = f.type != "plane" || facesPlane(f, regions[b].tris);
      if (fits && f.type != "mesh") {
        for (uint32_t v : verts[b])
          if (Distance(f, m.vert(v)) > tol) {
            fits = false;
            break;
          }
        // Vertices alone can't tell: a cylinder's end cap, meshed with every
        // vertex on its rim, has them all on the cylinder.  Its facets' middles
        // are far off it, where a facet of the surface itself sits off by no
        // more than its chord's sag -- the most a's own facets show.
        if (fits) {
          double sag = 0;
          for (uint32_t t : regions[a].tris) sag = std::max(sag, Distance(f, centroid[t]));
          for (uint32_t t : regions[b].tris)
            if (Distance(f, centroid[t]) > 2 * sag + tol) {
              fits = false;
              break;
            }
        }
      }
      if (!fits) continue;
      parent[b] = a;
      regions[a].tris.insert(regions[a].tris.end(), regions[b].tris.begin(),
                             regions[b].tris.end());
      verts[a].insert(verts[a].end(), verts[b].begin(), verts[b].end());
      if (f.type == "mesh") regions[a].fit.dev = std::max(f.dev, regions[b].fit.dev);
      regions[b].tris.clear();
    }
    std::vector<Region> kept;
    for (size_t i = 0; i < regions.size(); i++)
      if (find(i) == i) kept.push_back(std::move(regions[i]));
    regions = std::move(kept);
    for (size_t i = 0; i < regions.size(); i++)
      for (uint32_t t : regions[i].tris) regionOf[t] = int64_t(i);
  }

  // A triangle on the seam between two surfaces can fit both, and the one that
  // grew first took it.  Along a fillet's tangent rim the torus took thin flat
  // triangles lying exactly in the top plane, so the plane's region came out
  // short of the disc its face covers -- 4.6% on one meshing of a filleted
  // cylinder, 5.3% on another that differed only in which diagonal OCC chose
  // (it chooses differently on ARM and x86-64) -- and past 5% the rebuild's
  // area check sent the whole top back to triangles.  So each triangle goes to
  // a neighbouring region whose surface holds all its corners and passes
  // through its middle, to within a hundredth of the tolerance, nearer than
  // its own does: a triangle that LIES on the surface, as those flat ones lie
  // in the plane.  Only nearer was not enough -- on a bumpy freeform top the
  // local fits trade triangles that merely sit a little closer, and the
  // fragmented regions left 122 triangles where there had been 36.  A tie
  // never moves, so nothing changes hands back and forth.  Repeated, since a
  // rim can be more than one row deep.
  for (int pass = 0; pass < 4; pass++) {
    std::vector<std::pair<uint32_t, int64_t>> moves;
    for (size_t t = 0; t < T; t++) {
      const int64_t own = regionOf[t];
      if (own < 0 || regions[own].fit.type == "mesh") continue;
      double nearest = Distance(regions[own].fit, centroid[t]);
      int64_t to = -1;
      for (int k = 0; k < 3; k++) {
        const int64_t q = nbr[t][k];
        if (q < 0) continue;
        const int64_t c = regionOf[q];
        if (c < 0 || c == own || regions[c].fit.type == "mesh") continue;
        const Fit& f = regions[c].fit;
        const double d = Distance(f, centroid[t]);
        if (d >= nearest || d > 0.01 * tol) continue;
        bool holds = f.type != "plane" || facesPlane(f, {uint32_t(t)});
        for (int j = 0; j < 3 && holds; j++) holds = Distance(f, m.vert(m.idx[3 * t + j])) <= tol;
        if (holds) {
          nearest = d;
          to = c;
        }
      }
      if (to >= 0) moves.push_back({uint32_t(t), to});
    }
    if (moves.empty()) break;
    std::vector<char> leaving(T, 0);
    for (auto [t, to] : moves) leaving[t] = 1;
    for (Region& g : regions)
      g.tris.erase(std::remove_if(g.tris.begin(), g.tris.end(),
                                  [&](uint32_t t) { return leaving[t] != 0; }),
                   g.tris.end());
    for (auto [t, to] : moves) {
      regions[to].tris.push_back(t);
      regionOf[t] = to;
    }
  }

  // Each collapsed sliver goes to a region round it whose surface holds all
  // its vertices -- the first one found need not: at a pole the sliver's far
  // vertex can lie in a different region, 0.036 off the first's surface on a
  // bumpy sphere -- or, if none does, stays triangles.
  std::vector<std::vector<int64_t>> vertRegions(V);
  for (size_t t = 0; t < T; t++)
    if (!collapsed[t])
      for (int k = 0; k < 3; k++) {
        auto& list = vertRegions[m.idx[3 * t + k]];
        if (std::find(list.begin(), list.end(), regionOf[t]) == list.end())
          list.push_back(regionOf[t]);
      }
  int64_t slivers = -1;
  for (size_t t = 0; t < T; t++) {
    if (!collapsed[t]) continue;
    int64_t r = -1;
    for (int k = 0; k < 3 && r < 0; k++)
      for (int64_t c : vertRegions[m.idx[3 * t + k]]) {
        bool holds = true;
        if (regions[c].fit.type != "mesh")
          for (int j = 0; j < 3 && holds; j++)
            holds = Distance(regions[c].fit, m.vert(m.idx[3 * t + j])) <= tol;
        if (holds) {
          r = c;
          break;
        }
      }
    if (r < 0) {
      if (slivers < 0) {
        slivers = int64_t(regions.size());
        regions.push_back({{}, Fit{}});
      }
      r = slivers;
    }
    regions[r].tris.push_back(uint32_t(t));
    regionOf[t] = r;
  }

  Recognition out;
  out.mesh = std::move(m);
  out.regions = std::move(regions);
  out.regionOf = std::move(regionOf);
  out.nbr = std::move(nbr);
  out.area = std::move(area);
  out.normal = std::move(normal);
  return out;
}

// The most any facet of a curved region sags off its surface.
double MaxSag(const Recognition& r, const Region& g) {
  double sag = 0;
  for (uint32_t t : g.tris) {
    const uint32_t* v = &r.mesh.idx[3 * t];
    const V3 c = mul(add(add(r.mesh.vert(v[0]), r.mesh.vert(v[1])), r.mesh.vert(v[2])), 1.0 / 3);
    sag = std::max(sag, Distance(g.fit, c));
  }
  return sag;
}

// What is still triangles, or in regions too small to be well supported, is
// often a freeform surface fitted piece by piece: a surfboard fin came out as
// 1,500 local cones, spheres and planes with 9% of it left as triangles.
// Such facets are gathered across smooth edges into clusters facing within
// kFreeformCone of their mean (so each is one-valued over its plane), and a
// cluster becomes one B-spline face when the surface holds every vertex
// within the tolerance and every facet's middle within `sagLimit`, the most
// a chord of this mesh sags.  A coarse low-poly mesh -- a fin drawn with
// 5.6 mm edges, its vertices 0.08 off any local quadric -- is not samples of
// a smooth surface, and is left as it was.
constexpr double kFreeformCone = 20;
constexpr size_t kFreeformMin = 12;

void AddFreeform(Recognition& r, double tol, double creaseDeg, double sagLimit) {
  const Mesh& m = r.mesh;
  const size_t T = m.tris();
  const double cosCrease = std::cos(creaseDeg * M_PI / 180);
  const double cosCone = std::cos(kFreeformCone * M_PI / 180);
  std::vector<char> open(T, 0);
  for (const Region& g : r.regions)
    if (g.fit.type == "mesh" || g.tris.size() < kWellSupported)
      for (uint32_t t : g.tris) open[t] = r.area[t] > 0;
  std::vector<uint32_t> order;
  for (size_t t = 0; t < T; t++)
    if (open[t]) order.push_back(uint32_t(t));
  std::sort(order.begin(), order.end(),
            [&](uint32_t a, uint32_t b) { return r.area[a] > r.area[b]; });
  auto middle = [&](uint32_t t) {
    const uint32_t* v = &m.idx[3 * t];
    return mul(add(add(m.vert(v[0]), m.vert(v[1])), m.vert(v[2])), 1.0 / 3);
  };
  std::vector<std::vector<uint32_t>> taken;
  std::vector<Fit> fits;
  std::vector<std::vector<Region>> before;
  for (uint32_t s0 : order) {
    if (!open[s0]) continue;
    std::vector<uint32_t> mem{s0};
    open[s0] = 0;
    V3 sum = mul(r.normal[s0], r.area[s0]);
    for (size_t h = 0; h < mem.size(); h++)
      for (int k = 0; k < 3; k++) {
        const int64_t q = r.nbr[mem[h]][k];
        if (q < 0 || !open[q] || dot(r.normal[q], r.normal[mem[h]]) < cosCrease ||
            dot(r.normal[q], unit(sum)) < cosCone)
          continue;
        open[q] = 0;
        mem.push_back(uint32_t(q));
        sum = add(sum, mul(r.normal[q], r.area[q]));
      }
    if (mem.size() < kFreeformMin) continue;
    std::vector<V3> pts;
    V3 origin{0, 0, 0};
    for (uint32_t v : RegionVerts(m, mem)) {
      pts.push_back(m.vert(v));
      origin = add(origin, pts.back());
    }
    origin = mul(origin, 1.0 / double(pts.size()));
    std::shared_ptr<const Freeform> ff = FitFreeform(pts, unit(sum), origin, tol);
    if (!ff) continue;
    bool holds = true;
    for (uint32_t t : mem)
      if (FreeformDistance(*ff, middle(t)) > sagLimit) {
        holds = false;
        break;
      }
    if (!holds) continue;
    // What these facets were before, piece by piece, in case the face fails.
    std::map<int64_t, Region> pieces;
    for (uint32_t t : mem) {
      Region& piece = pieces[r.regionOf[t]];
      piece.fit = r.regions[r.regionOf[t]].fit;
      piece.home = r.regionOf[t];
      piece.tris.push_back(t);
    }
    Fit f;
    f.type = "bspline";
    f.freeform = ff;
    f.point = ff->origin;
    f.dir = ff->n;
    for (const V3& p : pts) f.dev = std::max(f.dev, FreeformDistance(*ff, p));
    taken.push_back(std::move(mem));
    fits.push_back(f);
    std::vector<Region> was;
    for (auto& [k, piece] : pieces) was.push_back(std::move(piece));
    before.push_back(std::move(was));
  }
  if (taken.empty()) return;
  std::vector<char> gone(T, 0);
  for (const auto& mem : taken)
    for (uint32_t t : mem) gone[t] = 1;
  std::vector<Region> kept;
  std::vector<int64_t> newIndex(r.regions.size(), -1);
  for (size_t i = 0; i < r.regions.size(); i++) {
    Region h;
    h.fit = r.regions[i].fit;
    for (uint32_t t : r.regions[i].tris)
      if (!gone[t]) h.tris.push_back(t);
    if (h.tris.empty()) continue;
    newIndex[i] = int64_t(kept.size());
    kept.push_back(std::move(h));
  }
  for (auto& was : before)
    for (Region& piece : was) piece.home = newIndex[piece.home];
  for (size_t k = 0; k < taken.size(); k++) {
    Region h;
    h.tris = std::move(taken[k]);
    h.fit = fits[k];
    h.before = std::move(before[k]);
    kept.push_back(std::move(h));
  }
  r.regions = std::move(kept);
  for (size_t i = 0; i < r.regions.size(); i++)
    for (uint32_t t : r.regions[i].tris) r.regionOf[t] = int64_t(i);
}

}  // namespace

// An exporter meshes every surface to one chord tolerance, which the mesh's
// well-supported curved regions show: a small fit that sags far beyond it is
// a wrong one -- three 10-facet "spheres" on a fin's plug sagged 0.29 to 0.36
// where its cylinders' facets sagged under 0.003, and rebuilt they bulged
// 15 mm^3 out of a body the mesh had flat.  So a second pass, only when the
// first has such a region, with small regions held to three times the
// largest sag a region of kWellSupported facets or more shows, plus the
// tolerance.  With no such region there is nothing to judge by.
Recognition Recognize(std::vector<double> pos, const std::vector<uint32_t>& idx,
                      double tol, double creaseDeg, double flatDeg) {
  Recognition rec = RecognizePass(pos, idx, tol, creaseDeg, flatDeg, 1e300);
  double chord = -1;
  for (const Region& g : rec.regions)
    if (g.fit.type != "plane" && g.fit.type != "mesh" && g.tris.size() >= kWellSupported)
      chord = std::max(chord, MaxSag(rec, g));
  if (chord >= 0) {
    const double cap = 3 * chord + tol;
    for (const Region& g : rec.regions)
      if (g.fit.type != "plane" && g.fit.type != "mesh" && g.tris.size() < kWellSupported &&
          MaxSag(rec, g) > cap) {
        rec = RecognizePass(std::move(pos), idx, tol, creaseDeg, flatDeg, cap);
        break;
      }
  }
  AddFreeform(rec, tol, creaseDeg, chord >= 0 ? 3 * chord + tol : 3 * tol);
  return rec;
}

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
  Recognition rec = Recognize(std::move(pos), idx, tol, creaseDeg, flatDeg);
  const Mesh& m = rec.mesh;
  std::vector<Region>& regions = rec.regions;
  const std::vector<int64_t>& regionOf = rec.regionOf;
  const std::vector<double>& area = rec.area;
  const size_t T = m.tris();

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
      js.set(o, "minorRadius", js.makeNumber(r.fit.minorRadius));
      if (r.fit.type == "ellipticCylinder")
        js.set(o, "xdir", js.makeFloat64Array(r.fit.xdir.data(), 3));
      if (r.fit.type == "bspline") {
        // Height above the plane through `point` (normal `dir`, axes ex, ey):
        // a uniform cubic B-spline on nx x ny spans of [x0, x1] x [y0, y1].
        const Freeform& ff = *r.fit.freeform;
        occjs::Val g = js.makeObject();
        js.set(g, "ex", js.makeFloat64Array(ff.ex.data(), 3));
        js.set(g, "ey", js.makeFloat64Array(ff.ey.data(), 3));
        const double box[4] = {ff.x0, ff.x1, ff.y0, ff.y1};
        js.set(g, "bounds", js.makeFloat64Array(box, 4));
        js.set(g, "nx", js.makeNumber(ff.nx));
        js.set(g, "ny", js.makeNumber(ff.ny));
        js.set(g, "heights", js.makeFloat64Array(ff.c.data(), ff.c.size()));
        js.set(o, "freeform", g);
      }
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
  for (const char* type :
       {"plane", "cylinder", "cone", "sphere", "torus", "ellipticCylinder", "bspline", "mesh"}) {
    js.set(c, type, js.makeNumber(counts[type]));
    js.set(tc, type, js.makeNumber(triCounts[type]));
  }
  js.set(out, "counts", c);
  js.set(out, "triangleCounts", tc);
  js.set(out, "triangles", js.makeNumber(double(T)));
  return out;
}
