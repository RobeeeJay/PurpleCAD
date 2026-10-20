# PurpleCAD's Icons

Every icon the app draws lives here as an SVG file, so you can open one in Affinity Designer, change it, save it, and see the change on the next build. Under `npm run dev` it should show up without a restart, since Vite watches these files. That's how it's wired up; I haven't watched it happen with a live edit yet.

They used to be hand-written `<svg>` markup scattered through the React components, which meant editing an icon was a job for a text editor and a steady nerve. Not any more.

## Editing an Icon

Open the file, change it, save it as SVG over the original. That's it. The file name is how the code asks for it (`union.svg` is `<SvgIcon name="union" />`), so keep the name.

Icons are drawn on a 24 x 24 grid, and the app scales them to whatever size the button wants (mostly 20 pixels in the toolbar, 14 in the timeline, 16 in the objects list). Keep the 24 x 24 artboard and they'll all line up.

The palette the existing icons use:

- `#6C3FD4`, the purple, for the main shape;
- `#D4A33F`, the gold, for points and highlights;
- `#C4C2B8`, the grey, for supporting lines.

## The Magic Magenta

Some icons change colour with the UI: the selection widgets, the timeline and the tree view icons follow hover, active and disabled states. In code that's `currentColor`, which a drawing program can't produce. So there's a convention:

**Pure magenta, `#FF00FF`, means "the UI's colour".** Draw those parts in magenta, and the app turns them into `currentColor` when it loads the icon. It also catches magenta written as `#F0F`, `rgb(255,0,255)` or `magenta`, which covers the ways Affinity writes it into a style.

So if you open an icon and parts of it are a startling shade of magenta, that's deliberate, and they'll be grey (or whatever the UI says) in the app. It's ugly on purpose: nobody uses pure magenta in a real icon by accident.

## What the Build Tidies Up

You don't need to clean an exported file by hand. When the app loads an icon (`src/components/icons/cleanIconSvg.js`) it:

- drops the XML prolog, the DOCTYPE, comments and `<metadata>`;
- drops `<title>` and `<desc>`, which would otherwise show their own tooltip over the button's;
- drops editor attributes (`serif:`, `inkscape:`, `sodipodi:`) and their namespace declarations;
- prefixes every `id` with the icon's name. Affinity calls the first gradient `_Linear1` in every file, and two icons on one screen would otherwise borrow each other's;
- keeps the root's styling (Affinity puts `fill-rule`, `stroke-linecap` and friends in a `style` on the `<svg>`) and moves it onto the rendered `<svg>`.

The cleaning is tested against a sample shaped like an Affinity Designer 2 export (`src/components/icons/__tests__/cleanIconSvg.test.js`). I wrote that sample from Affinity's known output format rather than from a file it saved, so if a real export trips something up, that test is the place to add it.

## Adding a New Icon

1. Draw it on a 24 x 24 artboard and save it here as `something.svg`, with a lower-case, hyphenated name.
2. Use it in a component:

```jsx
import SvgIcon from "../icons/SvgIcon.jsx";

<SvgIcon name="something" size={20} />
```

The import path depends on where the component sits. `size` sets both width and height; pass `width` and `height` instead if it isn't square. Any other props (`className`, `style`) go onto the `<svg>`.

If you misspell the name, `src/components/icons/__tests__/iconFiles.test.js` fails and lists the names with no file, so you find out from `npm test` rather than from a blank button.

## The `unused/` Folder

The original set of icons, drawn before the app's own versions moved on, is kept in `unused/`. Nothing loads from there: the app only reads the files at the top level of this folder. Some are older drafts of icons the app now draws differently (`save.svg`, `open.svg`, the visibility toggles), and some were never used at all. Take what's useful; delete the rest whenever you like.

## Limits

- The sketch view's constraint markers are the same files, rasterised, so editing `coincident.svg` changes the marker beside every coincident constraint too. That's on purpose, but it's worth knowing before you get adventurous with one.
- The cog icon (`cog.svg`) was traced from a real 8-tooth cog's outline. It's a plain path now, and editing it won't change the gears you draw.
- The font samples in the text dialog are still drawn by code, because they're generated from each font, not drawn.

The icons are reserved artwork, outside the code's licence. See `TRADEMARKS.md` at the top of the repository.
