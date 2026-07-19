# Importing & Exporting

[← Timeline & History](timeline-and-history.md) · [Contents](README.md)

PurpleCAD reads and writes several formats: its own editable `.pcad` documents,
plus STL and STEP for exchange with slicers and other CAD tools.

## The Document menus

Both live in the **Document** group at the far left of the toolbar:

![The Save / Export menu](assets/save-menu.png)

- **Save / Export** — write the document or export geometry.
- **Load / Import** — open a document or import a mesh/solid.

## Saving & opening documents (`.pcad`)

- **Save as `.pcad`** — the native format. It stores everything: sketches,
  constraints, the full [timeline](timeline-and-history.md), variables, and
  materials. Re-open it and every step is still editable.
- **Open a saved `.pcad`** — from the Load / Import menu.

Use `.pcad` as your working format and only export STL/STEP when you need to
print or share.

## Exporting geometry

| Export | Use it for |
| --- | --- |
| **STL** | 3D printing — a triangle mesh of the visible bodies |
| **STEP** | Handing a solid model to other CAD software |
| **PNG** | A snapshot image of the viewport |

Notes:

- Exports include the **visible** bodies only — hide helper geometry first (see
  [Navigating & Viewing](navigation.md)).
- STL/STEP export at the current **print precision**, straight from the mesh
  you see on screen, so what you export matches what's displayed.
- Exports rotate into the **Z-up** convention every CAD reader and slicer
  expects, so parts land the right way up.

## Importing geometry

| Import | Result |
| --- | --- |
| **STL mesh** | Brought in as a solid body |
| **STEP file** | Brought in as a solid body |

Imported bodies join the Objects list and the timeline like any other body, so
you can boolean, fillet, or pattern against them. (A round-trip STEP export →
import reproduces the solid.)

## Projects

The **Projects** button (Document group) manages multiple documents and switches
between them, and can **duplicate** a project — handy for trying a variation
without touching the original.

---

That's the full tour. Jump back to the **[Contents](README.md)**, or revisit
the workflow overview there to see how sketching, extruding, refining, combining,
and exporting fit together.
