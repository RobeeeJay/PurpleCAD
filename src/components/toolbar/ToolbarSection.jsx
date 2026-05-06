import React from "react";

const ToolbarSection = ({ label, children }) => (
  <div className="toolbar-section">
    <div className="toolbar-label">{label}</div>
    <div className="toolbar-buttons">{children}</div>
  </div>
);

export default ToolbarSection;
