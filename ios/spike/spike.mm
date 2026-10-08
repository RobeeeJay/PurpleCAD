// iPad port, Phase 0: can OpenCASCADE run on iOS, driven from JavaScript in a
// JavaScriptCore context on a background thread -- the model the port plans
// for the OCC op bodies (occ-bridge.cjs run under JSC instead of Node)?
//
// The same file builds for macOS and for iOS, and runs one workload two ways:
//   native  plain C++, the baseline;
//   jsc     a JSContext on a background thread whose script calls synchronous
//           native functions (occ.makeSolidFromMesh, occ.booleanOp, ...), as
//           occ-bridge.cjs calls the Node addon today.
// Workload: MultiSystem2's base STL (from test-files/multisystem2.pcad, via
// mesh.js) sewn into a solid, both 3.94 mm boss holes cut from it, the result
// meshed -- the import-sew + boolean + tessellate path a real cut takes.
//
// Usage: spike <mesh.bin> <native|jsc>
// Prints one JSON line: stage timings (ms), triangle counts, peak memory (MB).

#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>
#include <mach/mach.h>

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Tool.hxx>
#include <Poly_Triangulation.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Shell.hxx>
#include <gp_Ax2.hxx>

#include <chrono>
#include <fstream>
#include <map>
#include <vector>

// ── The OCC work, shared by both modes ──────────────────────────────────────
static std::map<int, TopoDS_Shape> g_shapes;
static int g_next = 1;
static int store(const TopoDS_Shape& s) {
  g_shapes[g_next] = s;
  return g_next++;
}

// Sew a triangle mesh into a solid and merge its coplanar faces, as the
// addon's import sew does (MakeSolidFromMesh without its caps and checks).
static int makeSolidFromMesh(const std::vector<double>& p,
                             const std::vector<uint32_t>& idx) {
  BRepBuilderAPI_Sewing sew(1.0e-6);
  for (size_t i = 0; i + 2 < idx.size(); i += 3) {
    gp_Pnt a(p[idx[i] * 3], p[idx[i] * 3 + 1], p[idx[i] * 3 + 2]);
    gp_Pnt b(p[idx[i + 1] * 3], p[idx[i + 1] * 3 + 1], p[idx[i + 1] * 3 + 2]);
    gp_Pnt c(p[idx[i + 2] * 3], p[idx[i + 2] * 3 + 1], p[idx[i + 2] * 3 + 2]);
    if (a.Distance(b) < 1e-12 || b.Distance(c) < 1e-12 || c.Distance(a) < 1e-12)
      continue;
    BRepBuilderAPI_MakePolygon poly(a, b, c, Standard_True);
    if (!poly.IsDone()) continue;
    BRepBuilderAPI_MakeFace face(poly.Wire(), Standard_True);
    if (face.IsDone()) sew.Add(face.Face());
  }
  sew.Perform();
  TopoDS_Shape sewn = sew.SewedShape();
  TopoDS_Shape result = sewn;
  for (TopExp_Explorer ex(sewn, TopAbs_SHELL); ex.More(); ex.Next()) {
    BRepBuilderAPI_MakeSolid ms(TopoDS::Shell(ex.Current()));
    if (ms.IsDone()) {
      result = ms.Solid();
      break;
    }
  }
  ShapeUpgrade_UnifySameDomain unify(result, Standard_True, Standard_True,
                                     Standard_False);
  unify.Build();
  return store(unify.Shape());
}

// A vertical cylinder standing at (x, y0, z), for the boss holes.
static int makeCylinder(double r, double h, double x, double y0, double z) {
  gp_Ax2 axis(gp_Pnt(x, y0, z), gp_Dir(0, 1, 0));
  return store(BRepPrimAPI_MakeCylinder(axis, r, h).Shape());
}

static int cut(int body, const std::vector<int>& tools) {
  TopTools_ListOfShape args, tls;
  args.Append(g_shapes[body]);
  for (int t : tools) tls.Append(g_shapes[t]);
  BRepAlgoAPI_Cut op;
  op.SetArguments(args);
  op.SetTools(tls);
  op.Build();
  if (!op.IsDone()) return 0;
  return store(op.Shape());
}

static int tessellate(int id, double deflection) {
  const TopoDS_Shape& s = g_shapes[id];
  BRepMesh_IncrementalMesh mesh(s, deflection);
  int tris = 0;
  for (TopExp_Explorer ex(s, TopAbs_FACE); ex.More(); ex.Next()) {
    TopLoc_Location loc;
    Handle(Poly_Triangulation) t =
        BRep_Tool::Triangulation(TopoDS::Face(ex.Current()), loc);
    if (!t.IsNull()) tris += t->NbTriangles();
  }
  return tris;
}

// ── Measurement ─────────────────────────────────────────────────────────────
static double nowMs() {
  using namespace std::chrono;
  return duration<double, std::milli>(steady_clock::now().time_since_epoch())
      .count();
}
// Peak physical footprint of this process -- what iOS's memory limit counts.
// (task_vm_info rather than proc_pid_rusage, which the iOS SDK doesn't have.)
static double peakFootprintMB() {
  task_vm_info_data_t info;
  mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
  if (task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&info, &count) !=
      KERN_SUCCESS)
    return -1;
  return info.ledger_phys_footprint_peak / 1048576.0;
}

// mesh.bin: uint32 vertex-float count, uint32 index count, then float64
// positions and uint32 indices; then the two hole centres as 3 float64 each,
// the hole radius, and the cut's top and bottom y.
struct Input {
  std::vector<double> positions;
  std::vector<uint32_t> indices;
  double holes[2][3];
  double radius, top, bottom;
};
static bool readInput(const char* path, Input& in) {
  std::ifstream f(path, std::ios::binary);
  uint32_t np = 0, ni = 0;
  if (!f.read((char*)&np, 4) || !f.read((char*)&ni, 4)) return false;
  in.positions.resize(np);
  in.indices.resize(ni);
  f.read((char*)in.positions.data(), np * 8);
  f.read((char*)in.indices.data(), ni * 4);
  f.read((char*)in.holes, sizeof in.holes);
  f.read((char*)&in.radius, 8);
  f.read((char*)&in.top, 8);
  f.read((char*)&in.bottom, 8);
  return (bool)f;
}

static NSString* runNative(const Input& in) {
  double t0 = nowMs();
  int body = makeSolidFromMesh(in.positions, in.indices);
  double t1 = nowMs();
  std::vector<int> tools;
  for (auto& h : in.holes)
    tools.push_back(makeCylinder(in.radius, in.top - in.bottom, h[0], in.bottom,
                                 h[2]));
  int holed = cut(body, tools);
  double t2 = nowMs();
  int tris = holed ? tessellate(holed, 0.005) : -1;
  double t3 = nowMs();
  return [NSString
      stringWithFormat:@"{\"mode\":\"native\",\"sewMs\":%.0f,\"cutMs\":%.0f,"
                       @"\"meshMs\":%.0f,\"totalMs\":%.0f,\"tris\":%d,"
                       @"\"peakMB\":%.0f}",
                       t1 - t0, t2 - t1, t3 - t2, t3 - t0, tris,
                       peakFootprintMB()];
}

// The same work driven by a script in a JSContext on a background thread,
// through synchronous native functions -- as occ-bridge.cjs drives the addon.
static NSString* runJSC(const Input& in) {
  __block NSString* out = nil;
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  NSThread* worker = [[NSThread alloc] initWithBlock:^{
    @autoreleasepool {
      JSContext* ctx = [[JSContext alloc] init];
      ctx.exceptionHandler = ^(JSContext* c, JSValue* e) {
        out = [NSString stringWithFormat:@"{\"mode\":\"jsc\",\"error\":\"%@\"}",
                                         e.toString];
      };
      JSValue* occ = [JSValue valueWithNewObjectInContext:ctx];
      // The mesh crosses into JS and back as typed arrays, as it does in the
      // app; the native side reads them straight from the array buffers.
      occ[@"makeSolidFromMesh"] = ^int(JSValue* pos, JSValue* idx) {
        JSContextRef c = [JSContext currentContext].JSGlobalContextRef;
        JSObjectRef po = JSValueToObject(c, pos.JSValueRef, nullptr);
        JSObjectRef io = JSValueToObject(c, idx.JSValueRef, nullptr);
        double* pp = (double*)JSObjectGetTypedArrayBytesPtr(c, po, nullptr);
        uint32_t* ip = (uint32_t*)JSObjectGetTypedArrayBytesPtr(c, io, nullptr);
        size_t np = JSObjectGetTypedArrayLength(c, po, nullptr);
        size_t ni = JSObjectGetTypedArrayLength(c, io, nullptr);
        return makeSolidFromMesh(std::vector<double>(pp, pp + np),
                                 std::vector<uint32_t>(ip, ip + ni));
      };
      occ[@"makeCylinder"] = ^int(double r, double h, double x, double y,
                                  double z) {
        return makeCylinder(r, h, x, y, z);
      };
      occ[@"cut"] = ^int(int body, NSArray* tools) {
        std::vector<int> t;
        for (NSNumber* n in tools) t.push_back(n.intValue);
        return cut(body, t);
      };
      occ[@"tessellate"] = ^int(int id, double defl) {
        return tessellate(id, defl);
      };
      occ[@"now"] = ^double() { return nowMs(); };
      ctx[@"occ"] = occ;

      // Hand the input over as typed arrays.
      JSContextRef c = ctx.JSGlobalContextRef;
      size_t pb = in.positions.size() * 8, ib = in.indices.size() * 4;
      void* pcopy = malloc(pb);
      void* icopy = malloc(ib);
      memcpy(pcopy, in.positions.data(), pb);
      memcpy(icopy, in.indices.data(), ib);
      auto freeBytes = [](void* bytes, void*) { free(bytes); };
      ctx[@"positions"] = [JSValue
          valueWithJSValueRef:JSObjectMakeTypedArrayWithBytesNoCopy(
                                  c, kJSTypedArrayTypeFloat64Array, pcopy, pb,
                                  freeBytes, nullptr, nullptr)
                    inContext:ctx];
      ctx[@"indices"] = [JSValue
          valueWithJSValueRef:JSObjectMakeTypedArrayWithBytesNoCopy(
                                  c, kJSTypedArrayTypeUint32Array, icopy, ib,
                                  freeBytes, nullptr, nullptr)
                    inContext:ctx];
      NSMutableArray* holes = [NSMutableArray array];
      for (auto& h : in.holes) [holes addObject:@[ @(h[0]), @(h[1]), @(h[2]) ]];
      ctx[@"holes"] = holes;
      ctx[@"radius"] = @(in.radius);
      ctx[@"top"] = @(in.top);
      ctx[@"bottom"] = @(in.bottom);

      JSValue* r = [ctx evaluateScript:@
          "(() => {"
           "  const t0 = occ.now();"
           "  const body = occ.makeSolidFromMesh(positions, indices);"
           "  const t1 = occ.now();"
           "  const tools = holes.map(([x, , z]) =>"
           "    occ.makeCylinder(radius, top - bottom, x, bottom, z));"
           "  const holed = occ.cut(body, tools);"
           "  const t2 = occ.now();"
           "  const tris = holed ? occ.tessellate(holed, 0.005) : -1;"
           "  const t3 = occ.now();"
           "  return JSON.stringify({ sewMs: Math.round(t1 - t0),"
           "    cutMs: Math.round(t2 - t1), meshMs: Math.round(t3 - t2),"
           "    totalMs: Math.round(t3 - t0), tris });"
           "})()"];
      if (!out)
        out = [NSString
            stringWithFormat:@"{\"mode\":\"jsc\",\"onMainThread\":%s,"
                             @"\"result\":%@,\"peakMB\":%.0f}",
                             [NSThread isMainThread] ? "true" : "false",
                             r.toString, peakFootprintMB()];
    }
    dispatch_semaphore_signal(done);
  }];
  worker.stackSize = 16 * 1024 * 1024;  // OCC recurses deeply in booleans
  [worker start];
  dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
  return out;
}

int main(int argc, const char* argv[]) {
  @autoreleasepool {
    if (argc < 3) {
      fprintf(stderr, "usage: spike <mesh.bin> <native|jsc>\n");
      return 2;
    }
    Input in;
    if (!readInput(argv[1], in)) {
      fprintf(stderr, "couldn't read %s\n", argv[1]);
      return 1;
    }
    NSString* line = strcmp(argv[2], "jsc") == 0 ? runJSC(in) : runNative(in);
    printf("%s\n", line.UTF8String);
  }
  return 0;
}
