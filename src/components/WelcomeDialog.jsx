import welcome from "../../WELCOME.md?raw";
import { useStore } from "../store";
import { parseMarkdown } from "./licenseMarkdown.js";
import { Block } from "./LicenseDialog.jsx";
import "../styles/VariablesDialog.css";
import "../styles/AboutDialog.css";

// The text is WELCOME.md, bundled at build time so it can be edited as a plain
// document.  Its first heading is the dialog's title.
const blocks = parseMarkdown(welcome);
const titleIdx = blocks.findIndex((b) => b.type === "heading");
const TITLE =
  titleIdx >= 0 ? blocks[titleIdx].text.map((r) => r.v).join("") : "Welcome";
const BODY = blocks.filter((_, k) => k !== titleIdx);

const WelcomeDialog = () => {
  const open = useStore((s) => s.welcomeDialogOpen);
  const close = useStore((s) => s.closeWelcomeDialog);
  if (!open) return null;

  // Only the button dismisses it: the warning has to be read and accepted, not
  // brushed aside by a stray click outside or the close box, and dismissing it
  // is what records it as seen for good.
  return (
    <div className="variables-dialog-backdrop">
      <div
        className="variables-dialog welcome-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={TITLE}
      >
        <div className="variables-dialog-header">
          <h2>{TITLE}</h2>
        </div>
        <div className="license-body welcome-body">
          {BODY.map((b, k) => (
            <Block key={k} block={b} />
          ))}
        </div>
        <div className="variables-dialog-footer">
          <div />
          <button className="variables-btn primary" onClick={close} autoFocus>
            I understand
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomeDialog;
