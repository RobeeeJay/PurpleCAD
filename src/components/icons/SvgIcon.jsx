// An icon from cad-icons/, drawn inline so it takes the UI's colour where the
// file uses the reserved magenta (see cleanIconSvg.js).  Edit the .svg and the
// icon changes on the next build, or at once under `npm run dev`.

import { cleanIconSvg } from "./cleanIconSvg.js";

const files = import.meta.glob("../../../cad-icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const ICONS = Object.fromEntries(
  Object.entries(files).map(([path, text]) => {
    const name = path
      .split("/")
      .pop()
      .replace(/\.svg$/, "");
    return [name, cleanIconSvg(text, name)];
  }),
);

export default function SvgIcon({ name, size = 20, width, height, ...rest }) {
  const icon = ICONS[name];
  if (!icon) throw new Error(`No icon cad-icons/${name}.svg`);
  return (
    <svg
      // The sketch view rasterises some icons as SVG images, which need it.
      xmlns="http://www.w3.org/2000/svg"
      viewBox={icon.viewBox}
      width={width ?? size}
      height={height ?? size}
      {...icon.attrs}
      {...rest}
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}
