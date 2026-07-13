import React, { useRef } from "react";
import { useStore } from "../store";
import { activePrecision } from "../three/resolution.js";
import { commitTexture } from "../three/cameraControls/texture.js";
import { useEscapeKey, useDebouncedPreview, NumberInput } from "./inputs.jsx";
import ToolErrorLine from "./ToolErrorLine.jsx";
import {
  BAR_STYLE,
  Field,
  barBtn,
  pickBtn,
  toggleBtn,
} from "./viewport/overlayBar.js";

// Texture tool overlay.  Pick a black-and-white PNG and a connected face set,
// then displace the surface by the image (a genuine 3D bump map): project
// from the centre face's plane or conform around a curved wall, with
// offsets / rotation / size / depth / wrap and a target mesh resolution.
const TextureDialog = () => {
  const textureTool = useStore((s) => s.textureTool);
  const items = useStore((s) => s.items);
  const variables = useStore((s) => s.variables);
  const printPrecision = useStore(activePrecision);
  const setTexturePicking = useStore((s) => s.setTexturePicking);
  const updateTextureParams = useStore((s) => s.updateTextureParams);
  const cancelTextureTool = useStore((s) => s.cancelTextureTool);
  const fileRef = useRef(null);

  const open = !!textureTool;
  const params = textureTool?.params;
  const hasFace = !!textureTool?.face;
  const faceCount = textureTool?.faceCount || 0;
  const facesValid = !!textureTool?.facesValid;
  const hasPng = !!params?.png;
  const ready = hasPng && hasFace && facesValid;

  const cancel = () => {
    useStore.getState()._cameraControls?.clearTexturePreview?.();
    useStore.getState()._cameraControls?.clearEmbossSelectedFaces?.();
    cancelTextureTool();
  };
  useEscapeKey(open, cancel);

  useDebouncedPreview(
    ready,
    () => useStore.getState()._cameraControls?.updateTexturePreview?.(),
    () => useStore.getState()._cameraControls?.clearTexturePreview?.(),
    [
      params?.png,
      params?.projection,
      params?.offsetHMm,
      params?.offsetVMm,
      params?.rotationDeg,
      params?.sizeMm,
      params?.depthMm,
      params?.resolutionMm,
      params?.wrap,
      textureTool?.face,
      textureTool?.faceSet,
      items,
    ],
  );

  if (!open) return null;

  const hint =
    textureTool.picking === "faces"
      ? "Click one or more connected faces to texture · Esc to cancel"
      : "Choose an image and faces, set the options, then Confirm · Esc to cancel";

  const confirm = async () => {
    if (!ready) return;
    await commitTexture({ items, printPrecision });
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") confirm();
    else if (e.key === "Escape") cancel();
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // re-picking the same file must re-fire
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      updateTextureParams({ png: reader.result, pngName: file.name });
    reader.readAsDataURL(file);
  };

  const toggleStyle = (on) => ({ ...toggleBtn(on), marginRight: 4 });
  const num = (label, key, step = "1", extra) => (
    <Field label={label} style={{ marginLeft: 8 }}>
      <NumberInput
        step={step}
        value={params[key]}
        variables={variables}
        onCommit={(n) => {
          if (Number.isFinite(n)) updateTextureParams({ [key]: n, ...extra });
        }}
        onKeyDown={onKey}
        style={{ width: 52 }}
      />
    </Field>
  );

  return (
    <>
      <div className="sketch-placement-hint">{hint}</div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          style={{ display: "none" }}
          onChange={onFile}
        />
        <button
          type="button"
          style={pickBtn(!hasPng)}
          onClick={() => fileRef.current?.click()}
          title="Choose a black-and-white image — white displaces outward, black stays"
        >
          {params.pngName ? `Image: ${params.pngName}` : "Image…"}
        </button>
        <button
          type="button"
          style={{ ...pickBtn(textureTool.picking === "faces"), marginLeft: 6 }}
          onClick={() => setTexturePicking("faces")}
          title="Pick one or more connected faces to texture (click again to deselect)"
        >
          {!hasFace
            ? "Faces"
            : `Faces${faceCount > 0 ? ` (${faceCount})` : ""} ${facesValid ? "✓" : "⚠"}`}
        </button>

        {num("Offset H", "offsetHMm")}
        {num("Offset V", "offsetVMm")}
        {num("Rot°", "rotationDeg", "15")}
        {num("Size", "sizeMm")}
        {num("Depth", "depthMm", "0.5")}
        {num("Res", "resolutionMm", "0.5")}

        <button
          type="button"
          style={{ ...toggleStyle(!!params.wrap), marginLeft: 8 }}
          onClick={() => updateTextureParams({ wrap: !params.wrap })}
          title="On tiles the image across the whole surface; off applies it once at the picked point"
        >
          Wrap
        </button>

        <button
          type="button"
          style={{
            ...toggleStyle(params.projection === "conform"),
            marginLeft: 4,
            display: "inline-flex",
            alignItems: "center",
          }}
          onClick={() =>
            updateTextureParams({
              projection:
                params.projection === "conform" ? "center" : "conform",
            })
          }
          title="On conforms the image around a curved face (cylinder / sphere / curved wall); off projects it from the centre-most face's plane"
          aria-label="Conform"
        >
          <svg viewBox="0 0 24 24" width="14" height="14">
            {/* Same glyph as the emboss Conform toggle: the body (thin circle)
                with the applied pattern wrapping around it (bold arc). */}
            <circle
              cx="12"
              cy="12"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              opacity="0.5"
            />
            <path
              d="M18.55 7.41 A8 8 0 1 1 18.55 16.59"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.3"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <button type="button" onClick={cancel} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!ready}
          title={
            ready
              ? "Confirm — apply the texture"
              : "Choose an image and pick faces first"
          }
          style={barBtn(true, !ready)}
        >
          Confirm
        </button>
      </div>
      <ToolErrorLine />
    </>
  );
};

export default TextureDialog;
