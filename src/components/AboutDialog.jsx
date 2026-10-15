import { useState } from "react";
import { useStore } from "../store";
import LicenseDialog from "./LicenseDialog.jsx";
import "../styles/VariablesDialog.css";
import "../styles/AboutDialog.css";

// __APP_VERSION__, __GIT_COMMIT__, and __DEPENDENCY_VERSIONS__ are baked in
// at build time by Vite's `define` (see vite.config.js). Vitest doesn't run
// through that config so guard with `typeof` to keep the test bundle from
// blowing up.
const VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
const COMMIT = typeof __GIT_COMMIT__ === "string" ? __GIT_COMMIT__ : "dev";
const DEPENDENCIES =
  typeof __DEPENDENCY_VERSIONS__ === "object" ? __DEPENDENCY_VERSIONS__ : {};

const AboutDialog = () => {
  const open = useStore((s) => s.aboutDialogOpen);
  const setOpen = useStore((s) => s.setAboutDialogOpen);
  // Above the early return: a hook after it changes the hook count when the
  // dialog opens, and React blanks the whole app.
  const [licenseOpen, setLicenseOpen] = useState(false);

  if (!open) return null;

  const close = () => {
    setLicenseOpen(false);
    setOpen(false);
  };
  const stop = (e) => e.stopPropagation();

  return (
    <div className="variables-dialog-backdrop" onClick={close}>
      <div className="variables-dialog about-dialog" onClick={stop}>
        <div className="variables-dialog-header">
          <h2>About</h2>
          <button
            className="variables-dialog-close"
            onClick={close}
            title="Close"
          >
            ×
          </button>
        </div>
        <div className="about-body">
          <img className="about-icon" src="./favicon.png" alt="PurpleCAD" />
          <div className="about-name">PurpleCAD</div>
          <div className="about-version">
            v{VERSION}
            <span className="about-commit">{COMMIT}</span>
          </div>
          <div className="about-license">
            License:{" "}
            <button
              type="button"
              className="about-license-link"
              onClick={() => setLicenseOpen(true)}
              title="Show the full license, the trademark policy and third-party licenses"
            >
              PolyForm Noncommercial 1.0.0
            </button>
          </div>
          <table className="about-deps">
            <tbody>
              {Object.entries(DEPENDENCIES).map(([name, version]) => (
                <tr key={name}>
                  <td className="about-deps-name">{name}</td>
                  <td className="about-deps-version">{version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {licenseOpen && <LicenseDialog onClose={() => setLicenseOpen(false)} />}
    </div>
  );
};

export default AboutDialog;
