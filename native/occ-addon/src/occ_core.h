// Shared declarations for the OCC core: the shape store, cancellation, and
// the selection / naming helpers the op files share.  Engine-independent --
// nothing here may include napi.h or JavaScriptCore (see occ_js.h).
#pragma once

#include "occ_js.h"

// ── Primitives ───────────────────────────────────────────────────────────
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>

// ── Sweep / loft / shell ─────────────────────────────────────────────────
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRepOffset_MakeOffset.hxx>
#include <gp_Pln.hxx>
#include <gp_Ax3.hxx>

// ── Helical thread (hole tool) ───────────────────────────────────────────
#include <Geom_CylindricalSurface.hxx>
#include <GCE2d_MakeSegment.hxx>
// Needed as COMPLETE types for the handle upcast below, which gcc will not
// form from forward declarations alone.
#include <Geom2d_Curve.hxx>
#include <Geom2d_TrimmedCurve.hxx>
#include <gp_Pnt2d.hxx>
#include <BRepLib.hxx>

// ── Wire / face builders (extrude) ──────────────────────────────────────
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepBuilderAPI_GTransform.hxx>
#include <BRepBuilderAPI_MakeShape.hxx>
#include <BRepBuilderAPI_ModifyShape.hxx>
#include <gp_GTrsf.hxx>
#include <gp_Mat.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>

// ── Boolean ops ──────────────────────────────────────────────────────────
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>

// ── Chamfer / fillet ────────────────────────────────────────────────────
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepTools.hxx>
#include <ChFi3d_FilletShape.hxx>

// ── Cooperative cancel (long-op abort) ───────────────────────────────────
#include <Message_ProgressIndicator.hxx>
#include <Message_ProgressRange.hxx>

// ── Solid volume check (mesh-sew orientation guard) ─────────────────────
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>

// ── Signal → exception conversion (survive kernel faults) ───────────────
#include <OSD.hxx>

// ── Meshing + tessellation access ────────────────────────────────────────
#include <BRepMesh_IncrementalMesh.hxx>
#include <IMeshTools_Parameters.hxx>
#include <BRep_Tool.hxx>
#include <Poly_Triangulation.hxx>
#include <Poly_Triangle.hxx>

// ── Topology traversal ──────────────────────────────────────────────────
#include <TopExp_Explorer.hxx>
#include <TopExp.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <TopTools_ListOfShape.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Compound.hxx>
#include <TopTools_DataMapOfShapeInteger.hxx>
#include <Geom_Plane.hxx>
#include <TopoDS_Shell.hxx>
#include <BRep_Builder.hxx>
#include <ShapeFix_Shell.hxx>
#include <TopLoc_Location.hxx>

// ── Face-normal + edge-distance helpers ─────────────────────────────────
#include <BRepAdaptor_Surface.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <Extrema_ExtFlag.hxx>
#include <Extrema_ExtAlgo.hxx>

// ── Math types ───────────────────────────────────────────────────────────
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>
#include <gp_Dir.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Trsf.hxx>

// ── STEP export ─────────────────────────────────────────────────────────
#include <STEPControl_Writer.hxx>
#include <STEPControl_StepModelType.hxx>
#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>

#include "mesh_tools.h"
#include "mesh_recognize.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <map>
#include <tuple>
#include <unordered_map>
#include <BRepTools.hxx>
#include <vector>

namespace occ {

using namespace occjs;

// Persistent topological naming: a stored shape carries a table of stable
// NAMES for its faces/edges, derived from creation provenance (which sketch
// entity / op produced them) rather than coordinates.  A selection stores a
// name; on rebuild the name resolves to the current subshape even after the
// geometry moved (a dimension edit), so chamfers/etc. stay bound to the
// intended face.  The maps hold the actual TopoDS_Shape subshapes of `shape`;
// they are valid only for THIS shape instance and are re-derived by each op.
struct ShapeRecord {
  TopoDS_Shape shape;
  std::map<std::string, TopoDS_Shape> faces;
  std::map<std::string, TopoDS_Shape> edges;
};

struct Vec3d { double x, y, z; };

struct FaceNormal { double x, y, z; bool valid; };

struct EdgeFaceSpec {
  // Edge endpoints (for edge selection), plus an optional resize-invariant
  // identifier: the two adjacent face normals (n1, n2).  When present these
  // are matched in preference to the endpoints, so a chamfer/fillet follows
  // its edge through a parametric resize that moves the endpoint coordinates.
  struct EdgeEp {
    double ax, ay, az, bx, by, bz;
    bool hasNormals;
    double n1x, n1y, n1z, n2x, n2y, n2z;
    // Persistent name (topological naming): the sorted pair of adjacent face
    // names.  Resolved directly before any coordinate/normal matching, so a rim
    // chamfer survives a re-tessellation that moves every vertex.
    std::string name;
  };
  // Face normal + optional centroid (for face selection), plus an optional
  // persistent name (topological naming) that resolves the exact face directly
  // when present, before any coordinate/normal matching.
  struct FaceNorm {
    double nx, ny, nz;
    bool hasCentroid;
    double cx, cy, cz;
    std::string name;
    // Curve detection (SelectSubGeoFaces): grow from the picked face across
    // edges where neighbouring faces meet within this angle -- the same rule
    // the hover highlight draws by -- so a click on a bore's wall takes the
    // whole wall.  0 = the picked face alone (and every older document).
    double smoothDeg = 0;
  };
  std::vector<EdgeEp> edges;
  std::vector<FaceNorm> faces;
};


// One selected edge plus an adjacent reference face (used only by the angle
// chamfer's AddDA; null for fillets / symmetric chamfers).
struct SelectedEdge {
  TopoDS_Edge edge;
  TopoDS_Face refFace;
};


// ── Kernel (occ_kernel.cc) ───────────────────────────────────────────────

Message_ProgressRange CancelRange();
bool CancelRequested();
void SetCancelFlag(volatile int32_t* flag);

int StoreRecord(const TopoDS_Shape& s,
                std::map<std::string, TopoDS_Shape> faces,
                std::map<std::string, TopoDS_Shape> edges);
int StoreShape(const TopoDS_Shape& s);
TopoDS_Shape FetchShape(int id);
ShapeRecord FetchRecord(int id);
void ReleaseStored(int id);
void ClearStore();
size_t StoreSize();

gp_Trsf BuildTransform(double tx, double ty, double tz, double rx, double ry,
                       double rz, double scale = 1.0);
void TessellateInto(const TopoDS_Shape& shape, double linearDeflection,
                    std::vector<float>& positions,
                    std::vector<uint32_t>& indices,
                    std::vector<uint32_t>* edges = nullptr);
long OpenEdgeCount(const TopoDS_Shape& shape, double deflection);

// ── Selection and naming (occ_select.cc) ────────────────────────────────

EdgeFaceSpec ParseSubGeo(Js& js, Val subGeo);
bool EdgeMatchesEndpoints(const TopoDS_Edge& edge, const Vec3d& posA,
                          const Vec3d& posB, double eps = 1e-3);
bool EdgeMidpointOnSegment(const TopoDS_Edge& edge, const Vec3d& a,
                           const Vec3d& b, double tol);
FaceNormal ComputeFaceNormal(const TopoDS_Face& face);
std::vector<FaceNormal> EdgeAdjacentNormals(
    const TopoDS_Edge& edge,
    const TopTools_IndexedDataMapOfShapeListOfShape& edgeFaceMap);
std::map<std::string, TopoDS_Shape> PropagateFaceNames(
    BRepBuilderAPI_MakeShape& mk, const TopoDS_Shape& result,
    const std::map<std::string, TopoDS_Shape>& inFaces);
std::map<std::string, TopoDS_Shape> RemapFaceNames(
    BRepBuilderAPI_ModifyShape& mk,
    const std::map<std::string, TopoDS_Shape>& inFaces);
std::map<std::string, TopoDS_Shape> NamePrimitiveFaces(
    const TopoDS_Shape& shape);
std::map<std::string, TopoDS_Shape> NameEdgesByFacePairs(
    const TopoDS_Shape& shape,
    const std::map<std::string, TopoDS_Shape>& faceNames);
int StoreNamedSolid(const TopoDS_Shape& s,
                    std::map<std::string, TopoDS_Shape> faces);
TopoDS_Face MostCommonAdjacentFace(const TopoDS_Shape& shape,
                                   const std::vector<SelectedEdge>& edges);
std::vector<SelectedEdge> SelectSubGeoEdges(
    const TopoDS_Shape& shape, const EdgeFaceSpec& spec,
    const std::map<std::string, TopoDS_Shape>* namedFaces = nullptr,
    const std::map<std::string, TopoDS_Shape>* namedEdges = nullptr);
std::vector<TopoDS_Face> SelectSubGeoFaces(
    const TopoDS_Shape& shape, const EdgeFaceSpec& spec,
    const std::map<std::string, TopoDS_Shape>* namedFaces = nullptr);

// ── Exported functions (registered in occ_io.cc) ────────────────────────

// occ_build.cc
Val PingStr(Js& js);
Val MakeBox(Js& js);
Val MakeSphere(Js& js);
Val MakeCylinder(Js& js);
Val MakeCone(Js& js);
Val MakeTorus(Js& js);
Val MakeExtrude(Js& js);
Val MakeRevolve(Js& js);
Val MakePipe(Js& js);
Val MakeLoft(Js& js);
Val TransformShape(Js& js);
Val MirrorShape(Js& js);
Val RotateShapeAxis(Js& js);
Val ScaleShape(Js& js);
Val ScaleShapeXYZ(Js& js);
// occ_modify.cc
Val BooleanOp(Js& js);
Val ChamferShape(Js& js);
Val FilletShape(Js& js);
Val PushPullFaces(Js& js);
Val DraftFaces(Js& js);
Val MakeShell(Js& js);
Val MakeHole(Js& js);
Val MakeThread(Js& js);
Val EnrichSubGeo(Js& js);
// occ_io.cc
Val TessellateShape(Js& js);
Val FaceNames(Js& js);
Val NamedFacePoint(Js& js);
Val ReleaseShape(Js& js);
Val ShapeVolume(Js& js);
Val ShapeToBrep(Js& js);
Val ShapeFromBrep(Js& js);
Val ClearAll(Js& js);
Val ShapeCount(Js& js);
Val SetCancelBuffer(Js& js);
Val ExportSTEP(Js& js);
Val ImportSTEP(Js& js);
Val MakeSolidFromMesh(Js& js);
Val MakeCubeTessellated(Js& js);

}  // namespace occ
