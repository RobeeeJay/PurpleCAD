import React from "react";
import { useStore } from "../store";
import "../styles/Toolbar.css";

import DocumentSection from "./toolbar/DocumentSection";
import SketchDrawSection from "./toolbar/SketchDrawSection";
import ObjectCreateSection from "./toolbar/ObjectCreateSection";
import SketchModifySection from "./toolbar/SketchModifySection";
import CombineSection from "./toolbar/CombineSection";
import BevelSection from "./toolbar/BevelSection";
import SweepSection from "./toolbar/SweepSection";
import ModifySection from "./toolbar/ModifySection";
import ConstrainSection from "./toolbar/ConstrainSection";
import RenderSection from "./toolbar/RenderSection";
import MaterialSection from "./toolbar/MaterialSection";
import OptionsSection from "./toolbar/OptionsSection";
import ToolbarSection from "./toolbar/ToolbarSection";

const Toolbar = () => {
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);

  const selectedItem = items.find((i) => i.id === selectedId);
  const isSketchMode = selectedItem?.type === "sketch";

  return (
    <div className="toolbar">
      <DocumentSection />
      {isSketchMode ? <SketchDrawSection /> : <ObjectCreateSection />}
      {isSketchMode && <SketchModifySection />}
      {/* Boolean, chamfer/bevel, and drop-to-ground combined into one
          object-editing section. */}
      {!isSketchMode && (
        <ToolbarSection label="Modify">
          <CombineSection bare />
          <BevelSection bare />
          <SweepSection bare />
          <ModifySection bare />
        </ToolbarSection>
      )}
      <ConstrainSection isSketchMode={isSketchMode} />
      <RenderSection />
      <MaterialSection />
      <OptionsSection />
    </div>
  );
};

export default Toolbar;
