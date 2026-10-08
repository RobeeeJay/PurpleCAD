// The shape store, cooperative cancel, transforms and tessellation.

#include "occ_core.h"

namespace occ {

static std::unordered_map<int, ShapeRecord> g_shapes;
static std::atomic<int> g_nextId{1};
static std::mutex g_mu;

// ── Cooperative cancel ───────────────────────────────────────────────────
// A long OCC build (boolean/chamfer/loft/…) is a single synchronous native
// call; the JS thread hosting it is blocked and can't receive a "cancel"
// message.  So the cancel flag lives in a SharedArrayBuffer written by ANOTHER
// thread (the Electron main process) and read here — OCC's builders poll
// UserBreak() through a Message_ProgressRange and throw when it flips, aborting
// the op mid-flight and freeing the CPU.  g_cancelPtr aliases the SAB's first
// int32 (0 = run, non-0 = cancel); it never moves (a SAB never detaches).
static volatile int32_t* g_cancelPtr = nullptr;

class CancelIndicator : public Message_ProgressIndicator {
 public:
  Standard_Boolean UserBreak() override {
    return g_cancelPtr != nullptr && *g_cancelPtr != 0;
  }
  // Pure virtual in Message_ProgressIndicator; we don't render progress, only
  // poll UserBreak, so this is a no-op.
  void Show(const Message_ProgressScope&, const bool) override {}
};

// Fresh range for one build; a static indicator is fine (only UserBreak
// matters, the progress fraction is unused).  The returned range references the
// indicator's root scope for the duration of the Build() call it's passed to.
Message_ProgressRange CancelRange() {
  static Handle(CancelIndicator) ind = new CancelIndicator();
  return ind->Start();
}

// Direct flag read for OUR OWN hot loops (per-triangle face building etc.),
// which aren't OCC algorithms and so never get a Message_ProgressRange.  Poll
// this every N iterations and throw to abort — the only way to make those
// stages cancellable.
bool CancelRequested() {
  return g_cancelPtr != nullptr && *g_cancelPtr != 0;
}

// The flag the host flips to abort: the Electron worker's SharedArrayBuffer
// (setCancelBuffer), or any int32 a native host owns.
void SetCancelFlag(volatile int32_t* flag) { g_cancelPtr = flag; }

int StoreRecord(const TopoDS_Shape& s,
                       std::map<std::string, TopoDS_Shape> faces,
                       std::map<std::string, TopoDS_Shape> edges) {
  int id = g_nextId.fetch_add(1, std::memory_order_relaxed);
  std::lock_guard<std::mutex> lk(g_mu);
  g_shapes[id] = ShapeRecord{s, std::move(faces), std::move(edges)};
  return id;
}

// Store a shape with no names (ops that don't yet propagate naming).
int StoreShape(const TopoDS_Shape& s) { return StoreRecord(s, {}, {}); }

TopoDS_Shape FetchShape(int id) {
  std::lock_guard<std::mutex> lk(g_mu);
  auto it = g_shapes.find(id);
  if (it == g_shapes.end())
    throw std::runtime_error("unknown shape id: " + std::to_string(id));
  return it->second.shape;
}

void ReleaseStored(int id) {
  std::lock_guard<std::mutex> lk(g_mu);
  g_shapes.erase(id);
}

void ClearStore() {
  std::lock_guard<std::mutex> lk(g_mu);
  g_shapes.clear();
}

size_t StoreSize() {
  std::lock_guard<std::mutex> lk(g_mu);
  return g_shapes.size();
}

// Copy of the full record (shape + name tables).  Empty maps when unnamed.
ShapeRecord FetchRecord(int id) {
  std::lock_guard<std::mutex> lk(g_mu);
  auto it = g_shapes.find(id);
  if (it == g_shapes.end())
    throw std::runtime_error("unknown shape id: " + std::to_string(id));
  return it->second;
}

// Build the T·Rz·Ry·Rx compound transform used by transformShape in
// operations.js.  gp_Trsf::Multiply(T) means this = this * T, so to get
// T·Rz·Ry·Rx we set the translation first, then multiply each rotation.
gp_Trsf BuildTransform(double tx, double ty, double tz,
                               double rx, double ry, double rz,
                               double scale) {
  gp_Trsf trsf;
  if (std::abs(scale - 1.0) > 1e-12) {
    trsf.SetScaleFactor(scale);
  }
  if (tx != 0 || ty != 0 || tz != 0) {
    gp_Trsf t;
    t.SetTranslation(gp_Vec(tx, ty, tz));
    trsf.Multiply(t);
  }
  // Apply rotations X, then Y, then Z so the composed rotation is Rx·Ry·Rz,
  // matching THREE.Euler's default 'XYZ' order — which is how every
  // item.rotation in the app is expressed.  The previous Z,Y,X order gave
  // Rz·Ry·Rx, which only coincides for single-axis rotations; a compound
  // gizmo rotation came out in a different orientation, so a boolean on a
  // gizmo-rotated object appeared to reset its orientation.
  if (rx != 0) {
    gp_Trsf r;
    r.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(1, 0, 0)), rx);
    trsf.Multiply(r);
  }
  if (ry != 0) {
    gp_Trsf r;
    r.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)), ry);
    trsf.Multiply(r);
  }
  if (rz != 0) {
    gp_Trsf r;
    r.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), rz);
    trsf.Multiply(r);
  }
  return trsf;
}

// Tessellate a shape and populate position/index vectors.
// Mirrors tessellate.js logic exactly (same deflection formula, same
// REVERSED-orientation winding flip).
void TessellateInto(const TopoDS_Shape& shape, double linearDeflection,
                            std::vector<float>& positions,
                            std::vector<uint32_t>& indices) {
  // Mesh via the parameters+range overload so a long tessellation polls the
  // cancel flag (UserBreak) and can be aborted — a high-precision emboss/boolean
  // result is one of the slowest stages.
  IMeshTools_Parameters meshParams;
  meshParams.Deflection = linearDeflection;
  meshParams.Angle = 0.3;
  meshParams.Relative = Standard_False;
  meshParams.InParallel = Standard_False;
  BRepMesh_IncrementalMesh mesher(shape, meshParams, CancelRange());

  TopExp_Explorer explorer(shape, TopAbs_FACE);
  for (; explorer.More(); explorer.Next()) {
    TopoDS_Face face = TopoDS::Face(explorer.Current());
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, loc);
    if (tri.IsNull()) continue;

    gp_Trsf trsf;
    if (!loc.IsIdentity()) trsf = loc.Transformation();
    bool reversed = (face.Orientation() == TopAbs_REVERSED);

    auto baseVert = static_cast<uint32_t>(positions.size() / 3);
    for (int i = 1; i <= tri->NbNodes(); i++) {
      gp_Pnt p = tri->Node(i).Transformed(trsf);
      positions.push_back(static_cast<float>(p.X()));
      positions.push_back(static_cast<float>(p.Y()));
      positions.push_back(static_cast<float>(p.Z()));
    }
    for (int i = 1; i <= tri->NbTriangles(); i++) {
      Standard_Integer n1, n2, n3;
      tri->Triangle(i).Get(n1, n2, n3);
      n1--; n2--; n3--;
      if (reversed) std::swap(n2, n3);
      indices.push_back(baseVert + static_cast<uint32_t>(n1));
      indices.push_back(baseVert + static_cast<uint32_t>(n2));
      indices.push_back(baseVert + static_cast<uint32_t>(n3));
    }
  }
}
// Does the solid tessellate without gaps -- no edge, after welding coincident
// vertices, used by only one triangle?  BRepCheck passes a
// cog bevelled 0.4 mm whose top face then meshes with a patch missing on every
// tooth (240 open edges, the same at every mesher setting tried), and the
// stricter BRepAlgoAPI_Check flags the good 0.3 mm result as well, so neither
// tells the two apart.  Gaps are what the user actually sees.  An edge used by
// THREE triangles is not counted: a good embossed ring's chamfer has one (a
// degenerate sliver in the mesh, measured: 0 open edges, 1 over-shared) and
// draws correctly, while every broken cog bevel had hundreds of open edges.
// The triangulation is cleared afterwards so the display meshing starts fresh.
// Edges of the shape's mesh used by only one triangle (-1: nothing meshed).
// A face BRepMesh can't triangulate is left out of the mesh, so it shows here
// as the open outline of the hole it leaves.
long OpenEdgeCount(const TopoDS_Shape& shape, double deflection) {
  std::vector<float> pos;
  std::vector<uint32_t> idx;
  TessellateInto(shape, deflection, pos, idx);
  BRepTools::Clean(shape);
  if (idx.empty()) return -1;
  // Weld: one id per distinct position, at a grid far below any feature.
  std::map<std::tuple<long long, long long, long long>, uint32_t> ids;
  std::vector<uint32_t> weld(pos.size() / 3);
  for (size_t i = 0; i < weld.size(); i++) {
    auto k = std::make_tuple(std::llround(pos[i * 3] * 1e5),
                             std::llround(pos[i * 3 + 1] * 1e5),
                             std::llround(pos[i * 3 + 2] * 1e5));
    auto it = ids.emplace(k, static_cast<uint32_t>(ids.size())).first;
    weld[i] = it->second;
  }
  std::map<std::pair<uint32_t, uint32_t>, int> uses;
  for (size_t t = 0; t + 2 < idx.size(); t += 3)
    for (int j = 0; j < 3; j++) {
      uint32_t a = weld[idx[t + j]], b = weld[idx[t + (j + 1) % 3]];
      if (a == b) continue;
      uses[{std::min(a, b), std::max(a, b)}]++;
    }
  long open = 0;
  for (const auto& kv : uses)
    if (kv.second == 1) open++;
  return open;
}

}  // namespace occ

// For mesh_tools.cpp's long loops.
bool MeshCancelRequested() { return occ::CancelRequested(); }

void occjs::Init() {
  // Convert hardware faults inside OCC algorithms (SIGSEGV/SIGFPE/…) into
  // catchable Standard_Failure exceptions on this thread.  OCC's fillet/chamfer
  // kernel (ChFi3d) occasionally NULL-derefs on degenerate stripe configurations
  // instead of throwing — observed in ChFi3d_Builder::PerformSetOfSurf when
  // chamfering faceted emboss geometry after a resolution switch — and since the
  // addon shares the app's process (worker_thread), that killed the whole app.
  // With SetSignal, the attempt fails like any other rejected geometry (our ops
  // already catch std::exception, which Standard_Failure derives from).  The
  // addon loads on the OCC worker thread, so this lands on the thread that runs
  // every op.
  OSD::SetSignal(Standard_False);
}
