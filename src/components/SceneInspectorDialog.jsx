// Scene inspector: a detailed, expandable listing of every object in the
// document for debugging — identity, transform (in both the user's Z-up frame
// and the raw internal three.js one), live mesh counts, the regenerator recipe,
// and for a sketch every shape and constraint.  Constraints that name a shape
// outside the array, or that disagree with the geometry they're bound to, are
// flagged: that combination is the signature of a structural edit that
// renumbered shapes without remapping the constraints.

import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store";
import {
  buildInspectorRows,
  inspectorReport,
} from "../three/sceneInspector.js";
import "../styles/ProjectsDialog.css";
import "../styles/SceneInspector.css";

const Vec = ({ detail }) => {
  if (!detail) return <span className="si-dim">—</span>;
  return (
    <span>
      {detail.display.map((d) => (
        <span key={d.label} className="si-axis">
          <b>{d.label}</b> {d.value ?? "—"}
        </span>
      ))}
      <span className="si-dim si-internal">
        (internal x {detail.internal.x} y {detail.internal.y} z{" "}
        {detail.internal.z})
      </span>
    </span>
  );
};

const Field = ({ label, children }) => (
  <div className="si-field">
    <span className="si-label">{label}</span>
    <span className="si-value">{children}</span>
  </div>
);

const ShapeRow = ({ s }) => (
  <tr>
    <td className="si-num">{s.idx}</td>
    <td>{s.type}</td>
    <td>
      {Object.entries(s.geometry || {}).map(([k, v]) => (
        <span key={k} className="si-kv">
          {k}=
          {typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}
        </span>
      ))}
    </td>
    <td className="si-dim">{s.flags.join(", ")}</td>
  </tr>
);

const ConstraintRow = ({ c }) => (
  <tr className={c.dangling || c.mismatch ? "si-bad" : ""}>
    <td className="si-num">{c.idx}</td>
    <td>{c.type}</td>
    <td>{c.value ?? <span className="si-dim">—</span>}</td>
    <td>
      {c.refs.map((r) => (
        <span key={r.field} className="si-kv">
          {r.field}={r.idx}
        </span>
      ))}
    </td>
    <td className="si-warn">
      {c.dangling ? "references a shape that doesn't exist" : c.mismatch || ""}
    </td>
  </tr>
);

const ItemCard = ({ row }) => {
  const [open, setOpen] = useState(false);
  const t = row.transform;
  return (
    <div className={`si-card ${row.warnings.length ? "si-card-warn" : ""}`}>
      <div className="si-card-head" onClick={() => setOpen((o) => !o)}>
        <span className="si-caret">{open ? "▼" : "▶"}</span>
        <span className="si-id">#{row.id}</span>
        <span className="si-name">{row.name ?? "(unnamed)"}</span>
        <span className="si-type">{row.type}</span>
        {!row.visible && <span className="si-tag">hidden</span>}
        {row.mesh.triangles != null && (
          <span className="si-dim">
            {row.mesh.vertices} verts · {row.mesh.triangles} tris
          </span>
        )}
        {row.warnings.map((w) => (
          <span key={w} className="si-warn">
            ⚠ {w}
          </span>
        ))}
      </div>
      {open && (
        <div className="si-card-body">
          <Field label="Position">
            <Vec detail={t.position} />
          </Field>
          <Field label="Rotation°">
            <Vec detail={t.rotationDeg} />
          </Field>
          <Field label="Scale">
            <Vec detail={t.scale} />
          </Field>
          {row.mesh.sizeMm && (
            <Field label="Size (mm)">
              {["x", "y", "z"].map((k) => (
                <span key={k} className="si-kv">
                  {k}={row.mesh.sizeMm[k]?.toFixed?.(2) ?? row.mesh.sizeMm[k]}
                </span>
              ))}
            </Field>
          )}
          {row.mesh.worldPosition && (
            <Field label="World pos">
              <Vec detail={row.mesh.worldPosition} />
            </Field>
          )}
          <Field label="Mesh">
            vertices={row.mesh.vertices ?? "—"} · triangles=
            {row.mesh.triangles ?? "—"} · baked=
            {row.mesh.bakedVertices ?? "—"}
          </Field>
          <Field label="Parent">{row.parentId ?? "root"}</Field>
          {row.material && (
            <Field label="Material">
              {row.material.color} · opacity {row.material.opacity}
            </Field>
          )}
          {row.recipe && (
            <Field label="Recipe">
              {Object.entries(row.recipe)
                .filter(([, v]) => v != null)
                .map(([k, v]) => (
                  <span key={k} className="si-kv">
                    {k}={Array.isArray(v) ? `[${v}]` : String(v)}
                  </span>
                ))}
            </Field>
          )}
          {row.extrude && (
            <Field label="Extrude">
              {Object.entries(row.extrude)
                .filter(([, v]) => v != null)
                .map(([k, v]) => (
                  <span key={k} className="si-kv">
                    {k}={typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </span>
                ))}
            </Field>
          )}
          {row.sketch && (
            <>
              <Field label="Sketch">
                shapes={row.sketch.shapeCount} · constraints=
                {row.sketch.constraintCount} · projected=
                {row.sketch.projectedShapes} · host=
                {row.sketch.hostSolidId ?? "—"}
                {row.sketch.underlay && (
                  <span className="si-kv">
                    {" · "}underlay={row.sketch.underlay.name} @{" "}
                    {row.sketch.underlay.widthMm}mm
                  </span>
                )}
              </Field>
              {row.sketch.shapes.length > 0 && (
                <table className="si-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>type</th>
                      <th>geometry</th>
                      <th>flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.sketch.shapes.map((s) => (
                      <ShapeRow key={s.idx} s={s} />
                    ))}
                  </tbody>
                </table>
              )}
              {row.sketch.constraints.length > 0 && (
                <table className="si-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>type</th>
                      <th>value</th>
                      <th>refs</th>
                      <th>problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.sketch.constraints.map((c) => (
                      <ConstraintRow key={c.idx} c={c} />
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const SceneInspectorDialog = () => {
  const open = useStore((s) => s.sceneInspectorOpen);
  const setOpen = useStore((s) => s.setSceneInspectorOpen);
  const items = useStore((s) => s.items);
  const controls = useStore((s) => s._cameraControls);
  const [filter, setFilter] = useState("");

  // Live mesh facts come from the renderer, not the store.
  const rows = useMemo(() => {
    if (!open) return [];
    return buildInspectorRows(items, (id) => {
      const stats = controls?.getObjectStats?.(id) || null;
      const sizeMm = controls?.getItemLocalSizeMm?.(id) || null;
      return stats || sizeMm ? { ...(stats || {}), sizeMm } : null;
    });
  }, [open, items, controls]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `#${r.id} ${r.name ?? ""} ${r.type}`.toLowerCase().includes(q),
    );
  }, [rows, filter]);

  if (!open) return null;
  const close = () => setOpen(false);
  const copy = () => {
    navigator.clipboard?.writeText(inspectorReport(rows));
  };

  return createPortal(
    <div className="projects-backdrop" onPointerDown={close}>
      <div
        className="projects-dialog scene-inspector-dialog"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="projects-header">
          <h2>Scene inspector</h2>
          <div className="projects-header-actions">
            <input
              className="si-filter"
              placeholder="Filter by id / name / type…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button
              className="projects-new-btn"
              onClick={copy}
              title="Copy the full inspection as JSON"
            >
              Copy JSON
            </button>
            <button className="projects-close" onClick={close} title="Close">
              ×
            </button>
          </div>
        </div>
        <div className="si-summary">
          {rows.length} object{rows.length === 1 ? "" : "s"}
          {shown.length !== rows.length && ` · ${shown.length} shown`}
        </div>
        <div className="si-list">
          {shown.length === 0 ? (
            <div className="si-dim si-empty">Nothing to show.</div>
          ) : (
            shown.map((r) => <ItemCard key={r.id} row={r} />)
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SceneInspectorDialog;
