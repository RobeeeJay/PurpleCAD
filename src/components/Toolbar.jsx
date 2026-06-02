import React from "react";
import { useStore } from "../store";
import "../styles/Toolbar.css";

import DocumentSection from "./toolbar/DocumentSection";
import SketchDrawSection from "./toolbar/SketchDrawSection";
import ObjectCreateSection from "./toolbar/ObjectCreateSection";
import SketchModifySection from "./toolbar/SketchModifySection";
import CombineSection from "./toolbar/CombineSection";
import BevelSection from "./toolbar/BevelSection";
import ModifySection from "./toolbar/ModifySection";
import ConstrainSection from "./toolbar/ConstrainSection";
import RenderSection from "./toolbar/RenderSection";
import OptionsSection from "./toolbar/OptionsSection";
import SnapSection from "./toolbar/SnapSection";

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
      {!isSketchMode && <CombineSection />}
      <BevelSection />
      {!isSketchMode && <ModifySection />}
      <ConstrainSection isSketchMode={isSketchMode} />
      <RenderSection />
      <OptionsSection />
      <SnapSection />
    </div>
  );
};

export default Toolbar;
