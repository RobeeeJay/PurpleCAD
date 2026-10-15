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
#include <queue>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

#include "mesh_tools.h"

using namespace recog;

Recognition Recognize(std::vector<double> pos, const std::vector<uint32_t>& idx,
                      double tol, double creaseDeg, double flatDeg) {
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
  // Every facet faces along the plane's normal.  Near a line, a thin facet is
  // within the tolerance of a plane at almost any tilt (a fillet's facets
  // came back as hundreds of planes), so position alone can't say a facet
  // is flat on a plane.
  auto facesPlane = [&](const Fit& f, const std::vector<uint32_t>& tris) {
    for (uint32_t t : tris)
      if (area[t] > 0 && std::abs(dot(normal[t], f.dir)) < cosFlat) return false;
    return true;
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
    // A torus has seven parameters; it gets more points to spare too.
    const Fit tor = vs.size() >= 14 ? FitTorus(m, tris, normal, centroid, area, vs) : Fit{};
    if (tor.type == "torus" && tor.dev <= tol) return tor;
    Fit f;  // stays triangles; remember how near the nearest fit came
    f.dev = std::min({plane.dev, rev.dev, sph.dev, tor.type == "torus" ? tor.dev : 1e300});
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
    if (f.type == "plane" && area[t] > 0 && std::abs(dot(normal[t], f.dir)) < cosFlat)
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
        return t == "plane" ? 0 : t == "cylinder" ? 1 : t == "cone" ? 2 : t == "sphere" ? 3 : 4;
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
    if (f.type == "mesh")
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
  for (const char* type : {"plane", "cylinder", "cone", "sphere", "torus", "mesh"}) {
    js.set(c, type, js.makeNumber(counts[type]));
    js.set(tc, type, js.makeNumber(triCounts[type]));
  }
  js.set(out, "counts", c);
  js.set(out, "triangleCounts", tc);
  js.set(out, "triangles", js.makeNumber(double(T)));
  return out;
}
