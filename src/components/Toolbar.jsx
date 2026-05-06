import React from "react";
import { useStore } from "../store";
import "../styles/Toolbar.css";

import DocumentSection from "./toolbar/DocumentSection";
import SketchDrawSection from "./toolbar/SketchDrawSection";
import ObjectCreateSection from "./toolbar/ObjectCreateSection";
import SketchModifySection from "./toolbar/SketchModifySection";
import ExtrudeSection from "./toolbar/ExtrudeSection";
import CombineSection from "./toolbar/CombineSection";
import ConstrainSection from "./toolbar/ConstrainSection";
import RenderSection from "./toolbar/RenderSection";
import OptionsSection from "./toolbar/OptionsSection";

const Toolbar = () => {
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);

  const selectedItem = items.find((i) => i.id === selectedId);
  const isSketchMode = selectedItem?.type === "sketch";
  const isExtrudeSelected = !isSketchMode && selectedItem?.type === "extrude";

  return (
    <div className="toolbar">
      <DocumentSection />
      {isSketchMode ? <SketchDrawSection /> : <ObjectCreateSection />}
      {isSketchMode && <SketchModifySection />}
      {isExtrudeSelected && <ExtrudeSection />}
      <CombineSection />
      <ConstrainSection isSketchMode={isSketchMode} />
      <RenderSection />
      <OptionsSection />
    </div>
  );
};

export default Toolbar;
