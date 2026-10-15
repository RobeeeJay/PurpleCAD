# Exact Surfaces From Imported STEP and STL Files

Import a STEP file of a part with a nice round bore, and what you get in PurpleCAD is a bag of triangles. Chamfer that bore and the chamfer runs round a polygon. Fillet it and OCC sews thousands of flat faces back into a solid first, which is slow, and sometimes it gives up. Everything PurpleCAD builds itself has used exact curves since the `curves2D` work, but anything you import still doesn't.

The two formats are very different problems, so this plan treats them separately. A STEP file already *contains* exact surfaces, and we throw them away; keeping them is a straightforward fix. An STL file never had any surfaces, only triangles, so getting curves out of one means recognising shapes in a mesh. That's possible for mechanical parts (planes, cylinders, cones, spheres) and not for organic ones, and the plan is honest about where that line is.

## Where We Are Now

Here is what an import does today, read from the source rather than remembered.

**STEP.** `occOps.js#importStep` reads the file with OCC's STEP reader, which produces exact surfaces, then tessellates the shape and *releases it*:

```js
const id = occ.importSTEP(stepText);
tess = occ.tessellate(id, printPrecision ?? 0.5);
occ.releaseShape(id);
```

`DocumentSection.jsx` hands the positions and indices to `finalizeImportedMesh` (mm and Z-up to scene units and Y-up, centred on the bounding box) and `addImportedSolid`, which makes a plain mesh item: a `csg` with `geometryData` and no regenerator. The exact shape is gone by the time the item exists. The edges OCC hands back with the mesh are dropped too.

**STL.** `parseStl`, then `weldForImport` (meshoptimizer), then the same `addImportedSolid`. Same kind of item.

**Every op afterwards.** `buildItemShapeLocal` rebuilds a mesh item by sewing its triangles into a solid (`makeSolidFromMesh`, which merges coplanar triangles and refuses meshes over 50,000 triangles so a later boolean can't hang). So a curved face is always a fan of flat faces to OCC, whatever the file said.

## Part One: Keep the STEP File's Surfaces

This is the easy half, and it's most of the value for anyone importing from another CAD program.

### Basic Design

An imported STEP body keeps its exact shape as its *recipe*, and is rebuilt from it like anything else. The mesh becomes what it is for every other body: the drawing of the recipe at the current Resolution.

### Steps

1. **Serialise the shape.** Add an addon op that writes the imported shape as OCC's BREP text (`BRepTools::Write` to a stream) and one that reads it back. BREP rather than the original STEP text because it's what OCC holds after translation, it reads back without re-running the STEP translator, and it can carry the import's transform baked in.
2. **Bake the import transform into the shape.** `finalizeImportedMesh` turns file coordinates (mm, Z-up) into scene units (Y-up) and centres the result. Do the same to the *shape* (scale by 1/`MM_PER_UNIT`, rotate −π/2 about X, translate by the bounding-box centre) before serialising, so the stored shape and the drawn mesh share a frame. The parity invariant in CLAUDE.md applies: the OCC rebuild's world bounding box must equal the mesh's.
3. **A new recipe kind.** The item gets `regenerator: { kind: "importedShape", brep, regeneratedAt }`. `buildItemShapeLocal` reads the BREP back instead of sewing the mesh, and the recalc re-tessellates it at the current Resolution, so a finer Resolution actually refines an imported bore. This goes in BOTH OCC implementations (`occOps.js` and `electron/occ-bridge.cjs`), with a `bridgeParity.test.js` case, as always.
4. **Watch the BREP riding the chain.** Every op's frozen `regenerator.source` nests the item before it, so a chain of ops on an imported body carries several copies of its BREP. Unlike `geometryData` it can't be pruned from the deeper copies, because it *is* the recipe they rebuild from. So it was measured before deciding (see below): for real parts it costs about what the mesh it replaces does, so it is stored as plain text and left unpruned for now.
5. **Edges for the outline.** Pass the edges OCC returns through `finalizeImportedMesh`, so an imported part draws its real edges rather than every triangle seam.

### Done, and What It Measured

Part One is built: `importStep` returns the shape as BREP text baked into the body's frame, the body's recipe is `{ kind: "importedShape", brep }`, both OCC implementations rebuild from it, and the recalc redraws it at the current Resolution. Tests are in `importedStepShape.test.js` and at the end of `e2e/import.spec.js`.

Here are the sizes for real STEP files: the twelve V-Core 3 printed parts I had to hand, plus two of OCCT's samples, imported at the 0.05 mm Resolution:

| File | STEP | BREP | Mesh (packed) | Import |
| --- | --- | --- | --- | --- |
| bed_arm_back | 183 kB | 191 kB | 6,098 tris, 144 kB | 54 ms |
| cable_tie | 206 kB | 266 kB | 90,210 tris, 1,659 kB | 198 ms |
| MGN12 3030 Centering Tool | 618 kB | 435 kB | 3,566 tris, 88 kB | 92 ms |
| motor_support_l | 36 kB | 28 kB | 3,744 tris, 88 kB | 19 ms |
| OCCT linkrods | 1,751 kB | 1,370 kB | 7,734 tris, 149 kB | 166 ms |

Across the fourteen files the BREP ran from 28 kB to 435 kB (1.4 MB for the multi-body linkrods sample), against meshes of 50 kB to 1.7 MB. So it's the same order as the mesh it stands in for, which is why it isn't packed. `cable_tie` is worth a second look: at 90,210 triangles its mesh is over the 50,000-triangle cap that sewing a mesh would refuse, and as a recipe it never gets sewn at all.

A trap for anyone measuring this again: a STEP file that *PurpleCAD exported* isn't representative. The exporter writes each body's baked mesh, one face per triangle, so its BREP is just triangles written longhand (13.5 MB for a ring with a 20,000-triangle mesh). Use a STEP file from real CAD software.

One side effect: the toolbar used to import at a fixed 0.5 mm and now imports at your Resolution, so imported parts are drawn more finely than before.

### What Won't Change

STEP bodies imported before this change have already lost their surfaces: the shape was released at import and the file isn't kept. The only way to give them curves is to import the file again. The upgrade-on-recalculation route that works for sketch profiles can't help, because there's nothing exact left to upgrade from. Say so in the release notes, not just here.

### How We'll Know It Works

- Unit tests: export a body with a cylinder and a cone to STEP, import it, then count faces and surface types on the rebuilt shape (a STEP round trip, the way `exactCurveExtrude.test.js` counts them). A chamfer on the imported bore's rim should select one circular edge.
- Resolution: the same import tessellated at 0.05 and 0.01 mm must give more triangles at the finer setting, where today it's fixed at whatever the import used.
- Size: record the BREP size against the old mesh size for at least one real part, and write both down in the commit.
- e2e: import a STEP through the real file input and check the item carries the recipe and survives a save and reload.

## Part Two: Recognising Surfaces in an STL

So can you get curves back out of a mesh? For a machined or printed mechanical part, mostly yes. For a scanned face or a sculpted figurine, no, and nothing here pretends otherwise. Those regions stay triangles.

### A Probe That Failed (Usefully)

OCC 8.0.1 ships `ShapeAnalysis_CanonicalRecognition`, which answers "is this face, shell or wire really a plane / cylinder / cone / sphere, within a tolerance?" That sounded like exactly the tool, so I tried it on the realistic input: an exact 10 mm-radius cylinder, tessellated at 0.05 and 0.01 mm, sewn back into a solid the way an import is, and its 45 (or 100) wall faces gathered into one shell. At tolerances of 0.001, 0.01 and 0.1 mm it returned status 1, "error, usually wrong input data", every time.

Reading the header explains it. The recogniser converts a face whose surface is already some other curve type (a B-spline that's secretly a cylinder, say), and its least-squares fitting is only reached through *wires*. A shell of flat triangle faces isn't what it's for. That probe was a throwaway, since reverted. The lesson: the fitting has to be ours, though the recogniser may still be useful later on the boundary wires between regions (see the Unknowns below).

### Basic Design

Find the regions of the mesh that are really one surface, fit that surface exactly, and rebuild those regions as exact faces. Anything that doesn't fit stays triangles. A part comes out as a hybrid: exact where it can be, faceted where it can't, and never worse than it went in.

### Steps

1. **Segment.** After the existing weld, grow regions across edges where neighbouring triangles' normals turn by less than a threshold, and stop at sharp creases. The creases of a mechanical part are where its real edges are, so this splits it into candidate faces.
2. **Fit each region.**
   - A plane is a least-squares fit, which is what the coplanar merge already does in effect.
   - A sphere has a closed-form algebraic fit.
   - A cylinder's axis is the direction its normals never point along: the smallest eigenvector of the normals' covariance. Then a circle fit in the plane across that axis gives the radius.
   - A cone is the same idea, with the normals tilted by the half angle.
   - Torus is optional, for fillets on round parts.
   Each fit reports its worst vertex deviation.
3. **Accept or reject.** A fit is kept only if every vertex of the region lies within a tolerance of it. The default should come from the mesh itself (its own chord error is the floor), with a tolerance field the user can change. Adjacent regions that fit the same surface merge: a cylinder sliced into strips by the mesher is one face.
4. **Rebuild.**
   - Each accepted region becomes a face on its exact surface, bounded by its boundary polyline projected onto that surface.
   - Boundary polylines that are really lines or circles (OCC's `IsLine` / `IsCircle` on a wire may do here) become exact edges. Others become B-splines through their points.
   - Rejected regions keep their triangles.
   - Sew the lot with a tolerance, and validate with BRepCheck, a closed-mesh check and a volume comparison against the original mesh.
   - On failure, fall back to the original mesh, so a bad conversion never costs the user their part.
5. **The tool.** A Modify tool, "Convert to Surfaces", on a mesh body:
   - A bottom-bar dialog with the tolerance.
   - A live preview colouring each region by what it was recognised as, plus a count ("212 faces: 30 planes, 12 cylinders, 2 cones, 168 triangles left").
   - A timeline step with a recipe (`kind: "meshToSurfaces"`, source, tolerance) and an Edit that reopens the same dialog, as every Modify tool has.

### Recognition: Built, and What It Measured

Steps 1 to 3 are in: the addon op `recognizeSurfaces` welds the mesh, splits it into smooth regions at 30° creases, and fits each region with the simplest surface (plane, cylinder, cone, sphere or torus) that every one of its vertices lies within the tolerance of. The fits are in `native/occ-addon/src/mesh_fit.cpp` and the segmentation in `mesh_recognize.cpp`. Nothing is rebuilt yet. It reports each region's type, fitted parameters and worst deviation, and labels every triangle with its region. The tests are in `recognizeSurfaces.test.js`, and every rule below has a test that fails without it (each was checked by removing it).

**A correction.** The first version of this section described *peeling*: when a smooth region fit nothing whole, its largest coplanar patch was peeled off as a plane and the rest refitted. That turned out to be wrong, and it's gone. On a cylinder with a filleted rim, once the top disc was peeled, the side's facet strips were each bigger than the fillet's facets, so they passed the "three times the mean patch" test one after another and came back as 47 flat faces. The bed-arm and slot figures this section used to quote were measured with peeling, and the ones below replace them.

What does the job now is **growing surfaces**. A region that fits nothing whole is several surfaces running tangentially into one another: a slot's flat sides into its round ends, a fillet into the wall and the top it joins, a cable tie's straight runs into its bends. Each is grown from a seed facet: fit a patch round the seed, take in every neighbour whose vertices lie on that surface, refit on what was taken, and repeat until it stops growing. Getting that right took most of the work, and the traps are worth writing down:

- **Simplest first, but not blindly.** Tried most-complex-first, a cylinder wall meshed with vertices only on its two rims fits a sphere exactly. So plane, then cylinder or cone, then sphere, then torus. But a cone has the slack to take a cylinder *and* a strip of the fillet beside it, and a small patch of a torus fits a sphere, so every kind that fits the seed patch is grown, and the simplest wins unless a more complex one takes over a quarter more facets.
- **Seed patches straddle surfaces.** A breadth-first patch from a long side strip reaches the fillet at the strip's end before it has enough of the side, and then fits neither. Seed patches are the facets with the nearest *centres* instead, tried at 128, 64, 32, 16 and 8 facets, and the choice is made across all of them: the 128-facet patch can cover a slot's whole round end plus the flat sides beside it, which only a torus fits (more on that below), while a smaller one finds the cylinder the end really is.
- **Flats go first, but only real ones.** A big flat facet seeds a patch that already runs into the fillet round it, so flats are grown before curved surfaces. But a cylinder's strips are flat too, so the first pass takes only flats with an *interior vertex*, one whose whole ring of facets lies in the flat: strips of a curved surface never have one. Two-facet rectangles, which have none either, go in a last pass.
- **A thin facet lies on almost any plane.** Near a line, a sliver is within the tolerance of a plane at nearly any tilt, and a fillet's facets came back as hundreds of "planes". A flat's facets must also face along its normal, to within half a degree.
- **Vertices alone can't tell.** OCC meshes a cylinder's end cap with every vertex on its rim, and those vertices do lie on the cylinder, so a growing cylinder swallowed its own caps. A facet's middle sits off its true surface by no more than its chord's sag, so a surface only takes facets whose middles are within twice the sag its seed patch showed, plus the tolerance. The top disc of the filleted cylinder is kept apart from the torus the same way.
- **Tori need a long arc.** A torus is found by following each facet normal in by a trial tube radius: on the right radius the points land on the centre circle. On a patch that is only a short arc of that circle, the circle can't be placed, and the estimate from facet centres is biased by their sag; a quarter of a fillet came out 2% small with its axis tilted 0.7°, three times the tolerance. The estimate is now refined by least squares on the vertices (Levenberg-Marquardt over all seven parameters), which gets that fillet to 4e-8, and it needs about 128 facets of arc to be found at all, hence the big seed patches. Only ring tori are accepted (major radius bigger than the tube); a self-intersecting torus fitted a sphere's worth of facets and can't carry a face.
- **Too few points.** A cylinder has five parameters, so through a handful of vertices one always passes exactly: a 4-facet fan on a printed calibration tower "fitted" a sphere to 1e-15. Curved fits need ten vertices, a torus fourteen.
- **Merging back.** Neighbouring regions on one surface are merged afterwards, so a cylinder grown in strips is one face. A region may join a larger neighbour of any kind whose surface holds all its vertices, with the same facet-middle check.
- **Pole slivers.** OCC's sphere mesh has a row of slivers at each pole that weld down to lines. They're left out of the segmentation and given to a neighbouring region whose surface holds all their vertices, or kept as triangles. Giving them to the first neighbour found put a vertex 0.036 off its surface on a bumpy sphere; the freeform test caught that.

Here is what it finds in the nineteen V-Core 3 printed-part STLs, at 0.01 mm tolerance, with the surface types OCC reads from each part's STEP twin as a rough reference. The STEP counts surfaces, not faces, and a fillet is often a trimmed cylinder or torus that I haven't broken out.

| File | Triangles | Time | Found | Left as triangles | STEP has |
| --- | --- | --- | --- | --- | --- |
| motor_support_l | 5,838 | 19 ms | 16 planes, 13 cylinders, 3 tori | 0.0% | 16 planes, 9 cylinders, 5 trimmed |
| pillow_block | 5,316 | 1 ms | 31 planes, 6 cylinders, 6 cones | 0.0% | 26 planes, 5 cylinders, 3 cones, 9 trimmed |
| xy_motor_cage_top_left | 12,428 | 17 ms | 99 planes, 23 cylinders, 11 cones | 0.0% | 93 planes, 19 cylinders, 6 cones, 15 trimmed |
| bed_arm_right | 11,450 | 195 ms | 76 planes, 22 cylinders, 6 cones, 8 tori, 1 mesh | 0.0% | 72 planes, 15 cylinders, 5 B-splines, 12 trimmed |
| lead_screw_motor_cage_back | 5,200 | 117 ms | 80 planes, 18 cylinders, 24 cones, 14 tori, 32 mesh | 2.7% | 70 planes, 16 cylinders, 12 cones, 8 trimmed |
| MGN12 3030 Centering Tool | 2,778 | 21 ms | 108 planes, 55 cylinders, 1 cone, 9 tori | 0.0% | 22 planes, 74 B-splines |
| cable_tie | 151,160 | 1,408 ms | 97 planes, 95 cylinders, 274 cones, 84 spheres, 61 tori, 32 mesh | 0.0% | 43 planes, 51 cylinders, 15 tori |

Eighteen of the nineteen leave under 0.5% of their triangles unrecognised. The lead screw cage's 2.7% is understood now: two of its regions are *ovals*, a wall 24 mm by 27 mm across and its 45° chamfer, and an elliptical wall is none of the five surfaces. An elliptical cylinder would be a straightforward addition (it's an extrusion of an ellipse); an elliptical cone has no OCC surface type and would have to be a B-spline. Neither is done. The rest of that file's leftovers are around an oblique blend whose corners are sharper than the 30° crease, so each facet is a region of its own. That's the polygon-or-coarse-curve ambiguity: an octagonal prism has to stay eight flat faces, and from the mesh alone the two look the same.

Where the STEP has B-splines or a swept curve (the centering tool, the cable tie's strap), the answer is many small local fits rather than a few surfaces: 274 cones and 84 spheres on the cable tie, each within the tolerance. The two surfboard fins, which are freeform throughout, come out as about 1,500 local fits each with 8% left as triangles, at 1.5 s. Every one of those holds its vertices within the tolerance (the freeform test checks exactly that on a bumpy sphere), so nothing is lost, but it's a lot of faces for what is really one smooth surface, and the rebuild will show whether that's a problem.

Size, measured on three scans: 1.5 million triangles took 14.6 s, 5.0 million 32.5 s and 6.0 million 29.3 s, between 5 and 10 µs a triangle; the freeform fins cost about 110 µs a triangle. The limit (below) was set by the rebuild, which costs far more, and the cable tie in the table is now over it; its figures were measured first.

### The Rebuild: Built, and What It Measured

Step 4 is in as the addon op `rebuildSurfaces` (`native/occ-addon/src/mesh_rebuild.cpp`), reached through both OCC implementations. It recognises the mesh, makes each region one face on its fitted surface and each leftover triangle a flat face of its own, and joins them into a solid. It returns the body as BREP text and drawn at the current Resolution, or refuses with the reason, in which case the caller keeps the mesh. The Convert to Surfaces tool (below) is what calls it. The tests are in `rebuildSurfaces.test.js`.

The design worry above, that exact faces and triangle faces wouldn't sew together, didn't come to pass, because they aren't sewn. The boundary between two regions is a run of mesh edges, and that run becomes *one* edge (a line, a circular arc, or a B-spline through its vertices), shared by both faces. So the solid's topology comes straight from the mesh. Sewing is kept as a second attempt and is used once in the corpus.

Proof that the faces are exact and not a good imitation is the volume. Rebuilt from their meshes, a box with a bore comes out at 28.92124 (true: 32 − 2π·0.49 = 28.92124; the mesh, 28.93271), a sphere at 14.13716 (4/3·π·1.5³; the mesh, 14.06986) and a torus at 9.86960 (2π²·2·0.25; the mesh, 9.81940).

What it took, most of it learned from what OCC's own fixes do to a face:

- **One fix context for all faces.** Adding a cylinder's seam splits the circle it shares with its end cap. Fixed face by face, the cap kept the old circle and the shell came apart ("not connected"). All faces' fixes now share one record of what was replaced.
- **Trim periodic surfaces to the region.** On a torus or a sphere, two circles bound two regions, and the fix took the wrong one when a boundary sat on the seam: a fillet came back as the other three quarters of its tube, 1.2 short in volume. Each periodic direction is trimmed to the arc the region's vertices span, so there's only one region to take. (Classifying a point and flipping the wires was tried first, and fails: the classifier only looks inside the wrong face's own bounds.)
- **Check curves both ways.** A B-spline can pass within the tolerance of every point and still bulge between two close ones; one bulged 0.010 off the torus it bounded. Curves are now sampled against the polyline as well.
- **Regions go back to triangles, one at a time.** When a region's boundary curves stray from its surface, its face covers a different area from its facets, the fix has had to widen its edges far past a chord's sag on that surface, or the face won't mesh, that region alone becomes triangles, and the build is retried. Faces the solid check objects to are traced back by their surface and demoted too. The chord-sag allowance is measured at the chord's ends: a chord across a near-flat cone passes near its axis, where the cone curves tightly but the region isn't, and that let a bad face keep a 0.020 edge.
- **What didn't help.** Checking each face's validity on its own demoted half the corpus's good faces, because a face can fail alone and be fine in the solid; it's gone. Counting open mesh edges, as the bevel checks do, failed every curved body: the edges are curve fits within the tolerance of both faces, so each face meshes them up to a tolerance apart. What matters, that every face meshes at all, is checked directly.

Then three follow-ups, each from something the first corpus run showed.

- **Edges along the real curve.** The loosest edges were all chords: a boundary where a plane cuts a cylinder or cone at an angle is really curved, but where the mesh has only its two ends, the run became a straight line, exact on the plane and sagging off the curved face (a 3.775 mm chord on a 14.25 mm radius sags 0.125, measured 0.126). Now, when a run's fitted curve strays more than twice the tolerance from either exact face, the edge is cut from the two surfaces' actual intersection (`mesh_edges.cpp`, `GeomAPI_IntSS`), trimmed between the run's ends. A plane and a cone meet in a trimmed ellipse, and a run past the trim's end got a range outside it, and the edge came out as the straight chord again; it uses the full periodic ellipse instead. The loosest edge on bed_arm_back went from 0.126 to 0.010, and on xy_joiner_left from 0.155 to 0.010. xy_motor_cage_top_left still has a 0.150 edge between a plane and a cone 3-4° off a cylinder: the run there is emitted as a straight line, and I haven't found why the intersection isn't used for it. It's inside the 20-tolerance gate, so the part rebuilds.
- **The bed arms.** Both were refused with "BadOrientationOfSubshape" on the shell, naming no face. ShapeFix_Shell had left a handful of edges walked the same way by both their faces (5 on one arm, 9 on the other) between faces that each faced the right way. Two changes: every face is turned to agree with its own mesh facets before the shell is assembled, rather than leaving that to ShapeFix_Shell; and any face on an edge walked the same way by both its faces goes back to triangles (or, for a triangle, the regions beside it, since a triangle bounded by a neighbour's curved edge is where the trouble comes from). Faces that won't mesh in the finished solid are traced back the same way. Both arms rebuild now, keeping about 1,200-1,450 triangles each. A trap on the way: I first keyed the edge map with OCC's shape hasher as a `std::map` comparator, which isn't an ordering, and the check silently found nothing.
- **Oval walls.** An elliptical cylinder is a sixth surface: the axis from the normals as for a cylinder, and a direct least-squares ellipse (Halir and Flusser's form of Fitzgibbon's) through the vertices seen down it. An oval prism comes back as one oval wall with its semi-axes exact, 1.35 and 1.20, and its volume true (10.17882 against π·1.35·1.2·2 = 10.17876; the mesh 10.17149). Left unchecked, the fit took degenerate ellipses (one 22 mm by 0.010 mm, one 4,536 mm long), which passed for pairs of near-flat facets and cost two parts hundreds of exact faces; an ellipse must now be no flatter than 1:10 and no bigger than twice the region, and one whose axes differ by no more than the tolerance is taken as the cylinder it is. The lead screw cage's "oval" turned out not to be one: it's a racetrack (two half-circles joined by short straights), and its 2.7% stays triangles. An elliptical *cone* (its chamfer) has no OCC surface type and would need a B-spline; not done.

And one rebuild bug the tool's tests found: a full cylinder meshed with sixteen sides was treated as a partial band, because its vertices leave a 22.5° gap between every pair of neighbours and the trim to the region used "a gap over 5% of the circle" as the sign of an opening. It was trimmed to 337.5° and collapsed to a face of no area. The widest gap now has to stand out from the rest (three times the next) to count as the region's opening.

On the V-Core STLs at 0.01 mm, with all of the above:

| File | Triangles | Time | Faces | Volume (mesh) | Loosest edge |
| --- | --- | --- | --- | --- | --- |
| lead_screw_motor_cage_front | 10,358 | 78 ms | 44 planes, 13 cylinders, 9 cones | 95,465.3 (95,468.8) | 0.010 |
| xy_motor_cage_top_left | 12,428 | 225 ms | 97 planes, 23 cylinders, 11 cones, 6 triangles | 45,685.6 (45,689.1) | 0.150 |
| pillow_block | 5,316 | 39 ms | 31 planes, 6 cylinders, 6 cones | 11,067.9 (11,068.4) | 0.010 |
| bed_arm_back | 12,778 | 528 ms | 98 planes, 23 cylinders, 249 triangles | 62,031.7 (62,042.6) | 0.010 |
| bed_arm_right | 11,450 | 1,506 ms | 75 planes, 21 cylinders, 1 cone, 1 torus, 1,156 triangles | 87,522.0 (87,525.9) | 0.074 |
| xy_joiner_right | 8,826 | 1,120 ms | 89 planes, 21 cylinders, 6 cones, 874 triangles | 45,973.4 (45,962.5) | 0.155 |
| cable_tie | 151,160 | | refused: over the size limit | | |

Eighteen of the nineteen rebuild, all within 0.05% of the mesh's volume; three with no triangles left, and the rest keeping from 2 to 1,440 where regions were put back. (Earlier versions of this section said sixteen of nineteen, with the bed arms refused; the follow-ups above are what changed.)

The **size limit** is 100,000 triangles, in recognition and rebuild alike. The rebuild costs per face, and what recognition leaves as triangles are a face each: the cable tie's ran 105 s and was then refused, while the 13k-triangle parts take under a second or two. 100,000 is *(est)* between those two measurements, not a measurement itself.


### The Tool: Built

Step 5 is in. **Convert to Surfaces**, on the Modify toolbar beside Simplify, takes a mesh body (an import, or a simplified one; anything modelled in PurpleCAD already has exact faces). Its bottom-bar dialog has one field, the tolerance (0.01 mm to start), and a live preview that only *recognises* (fast), colouring each triangle by the surface its region was found to be, with a key and a count: "3 faces: 2 planes, 1 cylinder", or "… 168 triangles left". Convert runs the rebuild; if it's refused, the error line says why ("Kept as a mesh: …") and the body is left as it was.

The committed body is a `csg` with `regenerator: { kind: "meshToSurfaces", toleranceMm, source, brep, stats }`. The BREP is its shape: `buildItemShapeLocal` reads it back in both OCC implementations, so a later chamfer or boolean works on the exact faces, not the triangles; a recalculation re-runs the conversion from the source mesh at the current Resolution and carries the new BREP forward; a refused rebuild leaves the body sewn from its mesh, as before. The timeline step has an Edit that reopens the same dialog and saves in place. Tests: `convertSurfaces.test.js` (the exact volume, a finer Resolution drawing the real curve, a later op building from the BREP and not the mesh), a parity case, and an e2e test through the real toolbar, dialog, timeline Edit and a boolean in `modify-tools.spec.js`.

### How We'll Know It Works

- Synthetic meshes with a known answer: tessellate exact shapes (a plate with a bore, a stepped shaft, a cone) at several Resolutions, convert, and check the surface types, the face count, and that every exact face lies within tolerance of the original surface.
- Noise: the same meshes with small random vertex jitter, to find where recognition breaks down, measured rather than assumed.
- Real files: at least one printed-part STL. `test-files/multisystem2.pcad` carries an imported STL base with known sewing trouble, which makes it a good stress test.
- Downstream: a chamfer on a converted bore's rim should select one circular edge and bevel in about the time it takes on a body built in PurpleCAD.

## Unknowns and Risks

- **Hybrid sewing** turned out not to be needed: shared edges built from the mesh join exact and triangle faces directly (see the rebuild above). The fallback is per region rather than per group, which is better than the plan expected.
- **Fillet bands** are found as tori when they have about 128 facets of arc; thinner ones grow as cylinder or cone strips, or stay triangles. Measured on one filleted cylinder and the corpus, not more widely.
- **Speed** is now measured: see the size limit above. The 50,000-triangle import cap is unchanged.
- **Recogniser on wires** wasn't needed: run curves are fitted directly as lines, arcs and B-splines.
- **Still open:** many small faces on freeform parts; the one 0.150 mm edge on xy_motor_cage_top_left; elliptical cones; and bodies that keep hundreds of triangles where a region's face wouldn't hold.

## Order of Work

1. Part One, the STEP recipe, first: the most value for the least risk, and it settles the recipe and parity plumbing that Part Two's output will reuse.
2. Part Two, steps 1 to 3 (segmentation and fitting) as a pure, unit-tested module with a report of what it found. No geometry is rebuilt yet, so it can be measured on real files before anything depends on it.
3. Part Two, step 4 (the rebuild), behind the fallback.
4. Part Two, step 5 (the tool and its timeline Edit), with e2e coverage.

Each step lands as its own commit with its tests and its measurements, and each can stop there if the measurements say the next one isn't worth it.
