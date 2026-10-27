import { useState } from "react";
import license from "../../LICENSE.md?raw";
import trademarks from "../../TRADEMARKS.md?raw";
import thirdParty from "../../THIRD_PARTY_LICENSES.md?raw";
import occtLgpl from "../../licenses/occt/LICENSE_LGPL_21.txt?raw";
import occtException from "../../licenses/occt/OCCT_LGPL_EXCEPTION.txt?raw";
import { parseMarkdown } from "./licenseMarkdown.js";
import "../styles/VariablesDialog.css";
import "../styles/AboutDialog.css";

// The full licence, opened from the About box.  The texts are the repository's
// own files, bundled at build time, so what the app shows can't drift from
// what the project is licensed under.
const TABS = [
  { id: "license", label: "License", markdown: license },
  { id: "trademarks", label: "Trademarks", markdown: trademarks },
  { id: "third-party", label: "Third-party", markdown: thirdParty },
  {
    id: "occt",
    label: "Open CASCADE",
    plain: `${occtException.trim()}\n\n\n${occtLgpl}`,
  },
];

// A web link opens in the system browser -- followed in place it would take
// the app window itself away from PurpleCAD.  Any other link (the PolyForm
// text's #section anchors) is shown as plain text.
const isWeb = (href) => /^https?:\/\//.test(href);
const openLink = (e, href) => {
  e.preventDefault();
  window.electronAPI?.openExternal?.(href);
};

const Runs = ({ runs }) =>
  runs.map((r, k) => {
    if (r.t === "strong") return <strong key={k}>{r.v}</strong>;
    if (r.t === "em") return <em key={k}>{r.v}</em>;
    if (r.t === "code") return <code key={k}>{r.v}</code>;
    if (r.t === "link" && isWeb(r.href))
      return (
        <a
          key={k}
          href={r.href}
          title={`Open ${r.href} in your browser`}
          className="license-link"
          onClick={(e) => openLink(e, r.href)}
        >
          {r.v}
        </a>
      );
    return <span key={k}>{r.v}</span>;
  });

export const Block = ({ block }) => {
  switch (block.type) {
    case "heading": {
      const H = `h${Math.min(block.level + 2, 6)}`;
      return (
        <H className="license-heading">
          <Runs runs={block.text} />
        </H>
      );
    }
    case "rule":
      return <hr className="license-rule" />;
    case "quote":
      return (
        <blockquote className="license-quote">
          <Runs runs={block.text} />
        </blockquote>
      );
    case "list": {
      const L = block.ordered ? "ol" : "ul";
      return (
        <L className="license-list">
          {block.items.map((it, k) => (
            <li key={k}>
              <Runs runs={it.text} />
              {it.children.length > 0 && (
                <ul className="license-list">
                  {it.children.map((c, j) => (
                    <li key={j}>
                      <Runs runs={c} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </L>
      );
    }
    case "table":
      return (
        <div className="license-table-wrap">
          <table className="license-table">
            <thead>
              <tr>
                {block.head.map((c, k) => (
                  <th key={k}>
                    <Runs runs={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, k) => (
                <tr key={k}>
                  {row.map((c, j) => (
                    <td key={j}>
                      <Runs runs={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return (
        <p className="license-para">
          <Runs runs={block.text} />
        </p>
      );
  }
};

const LicenseDialog = ({ onClose }) => {
  const [tab, setTab] = useState("license");
  const current = TABS.find((t) => t.id === tab);
  const stop = (e) => e.stopPropagation();

  return (
    // Rendered inside the About box's backdrop: a click here must not also
    // reach that one and close the About box.
    <div
      className="variables-dialog-backdrop license-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="variables-dialog license-dialog"
        onClick={stop}
        role="dialog"
        aria-label="License"
      >
        <div className="variables-dialog-header">
          <h2>License</h2>
          <button
            className="variables-dialog-close"
            onClick={onClose}
            title="Close"
          >
            ×
          </button>
        </div>
        <div className="license-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              className={`license-tab ${t.id === tab ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="license-body" key={tab}>
          {current.plain ? (
            <pre className="license-plain">{current.plain}</pre>
          ) : (
            parseMarkdown(current.markdown).map((b, k) => (
              <Block key={k} block={b} />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default LicenseDialog;
