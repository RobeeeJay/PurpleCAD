import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import ToolbarDropdown from "./ToolbarDropdown";
import SvgIcon from "../icons/SvgIcon.jsx";

const WireframeIcon = () => <SvgIcon name="render-wireframe" size={20} />;

const TransparentIcon = () => <SvgIcon name="render-transparent" size={20} />;

const ShadedIcon = () => <SvgIcon name="render-solid" size={20} />;

const PathTraceIcon = () => <SvgIcon name="render-smooth" size={20} />;

// The four ways of DRAWING the scene, as one mutually-exclusive choice.  They
// were four buttons; a dropdown showing the active one costs a single slot in
// a toolbar that has to hold every tool the app has.
const VIEWS = [
  {
    key: "wireframe",
    label: "Wireframe",
    title: "Wireframe (1)",
    Icon: WireframeIcon,
  },
  {
    key: "transparent",
    label: "Transparent",
    title: "Transparent (50%) (2)",
    Icon: TransparentIcon,
  },
  { key: "shaded", label: "Shaded", title: "Shaded (3)", Icon: ShadedIcon },
  {
    key: "pathtrace",
    label: "Path traced",
    title: "Path-traced render (prototype) — progressive GPU ray tracing (4)",
    Icon: PathTraceIcon,
  },
];

const RenderSection = () => {
  const renderMode = useStore((s) => s.renderMode);
  const setRenderMode = useStore((s) => s.setRenderMode);
  const shadowsEnabled = useStore((s) => s.shadowsEnabled);
  const setShadowsEnabled = useStore((s) => s.setShadowsEnabled);
  const crossSectionView = useStore((s) => s.crossSectionView);
  const toggleCrossSectionView = useStore((s) => s.toggleCrossSectionView);
  const pathTraceView = useStore((s) => s.pathTraceView);
  const setPathTraceView = useStore((s) => s.setPathTraceView);
  const projectionMode = useStore((s) => s.projectionMode);
  const toggleProjectionMode = useStore((s) => s.toggleProjectionMode);
  // The raster modes read as selected only when the path-traced view is off, so
  // all four behave as one mutually-exclusive radio group.
  const rasterMode = (m) => renderMode === m && !pathTraceView;
  // The trigger wears the icon of whichever view is live, so the toolbar still
  // says which one you are in without spending four slots to do it.
  const active =
    VIEWS.find((v) =>
      v.key === "pathtrace" ? pathTraceView : rasterMode(v.key),
    ) ?? VIEWS[2];
  const ActiveViewIcon = active.Icon;

  return (
    <ToolbarSection label="Render">
      <ToolbarDropdown
        trigger={<ActiveViewIcon />}
        title={`View: ${active.label} — wireframe, transparent, shaded or path traced`}
        items={VIEWS.map((v) => ({
          key: v.key,
          label: v.label,
          title: v.title,
          icon: <v.Icon />,
          active: v.key === active.key,
          onClick: () =>
            v.key === "pathtrace"
              ? setPathTraceView(true)
              : setRenderMode(v.key),
        }))}
      />
      <button
        className={`toolbar-btn ${shadowsEnabled ? "active" : ""}`}
        title={
          shadowsEnabled
            ? "Shadows on — click to disable (5)"
            : "Shadows off — click to enable ground-plane shadows (5)"
        }
        onClick={() => setShadowsEnabled(!shadowsEnabled)}
      >
        <SvgIcon name="toggle-shadows" size={20} />
      </button>
      <button
        className={`toolbar-btn ${crossSectionView ? "active" : ""}`}
        title={
          crossSectionView
            ? "Cross section view on — click to disable (6)"
            : "Cross section view — hide everything in front of the section plane (tracks the camera) (6)"
        }
        onClick={toggleCrossSectionView}
      >
        <SvgIcon name="section-analysis" size={20} />
      </button>
      <button
        className={`toolbar-btn ${projectionMode === "orthographic" ? "active" : ""}`}
        title={`Switch to ${projectionMode === "perspective" ? "orthographic" : "perspective"} projection`}
        onClick={toggleProjectionMode}
      >
        <SvgIcon name="isometric-view" size={20} />
      </button>
    </ToolbarSection>
  );
};

export default RenderSection;
