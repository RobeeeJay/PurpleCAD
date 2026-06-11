import React from "react";
import "../styles/VersionTag.css";

// __APP_VERSION__ and __GIT_COMMIT__ are baked in at build time by Vite's
// `define` (see vite.config.js).  Vitest doesn't run through that config
// so guard with `typeof` to keep the test bundle from blowing up.
const VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
const COMMIT = typeof __GIT_COMMIT__ === "string" ? __GIT_COMMIT__ : "dev";

const VersionTag = () => (
  <div className="version-tag" aria-hidden="true">
    v{VERSION}
    <span className="version-tag-sep">·</span>
    <span className="version-tag-commit">{COMMIT}</span>
  </div>
);

export default VersionTag;
