#!/usr/bin/env python3
"""Rebuild every platform's app icon from app-icons/PurpleCad Icon.png.

Needs Pillow (`pip install pillow`); run it after replacing that master image:

    python3 scripts/make-app-icons.py

Each platform gets the shape it expects, which is NOT the same shape:

  macOS   up to 15 the system draws no mask, so the icon must BE the rounded
          squircle, inset in a transparent canvas to Apple's proportions (824
          of 1024); a full-bleed square there looks oversized.  macOS 26 is
          the opposite and reads PurpleCAD.icon instead (see main()).
  Windows square and full-bleed -- the taskbar and Start menu round nothing,
          so an inset icon just renders small.
  Linux   square and full-bleed; the desktop environment applies its own
          shaping, and hicolor theme dirs are sized by the file, not the art.
  iOS     square, full-bleed, and with NO alpha channel at all, which the App
          Store requires; the system applies its own mask.
"""

import json
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, "app-icons", "PurpleCad Icon.png")
SS = 4  # supersampling for the mask edge

# Apple's icon grid: the art sits in a rounded square 824 wide on a 1024
# canvas, with a corner radius of 185.4 -- 22.5% of the square's side.
MAC_CONTENT = 824 / 1024
MAC_RADIUS = 0.225
# Apple's corner is a superellipse ("squircle"), not a circular arc; n≈5 is the
# usual approximation and reads correctly beside the system icons.
SQUIRCLE_N = 5.0


def squircle_mask(size, radius_frac=MAC_RADIUS, n=SQUIRCLE_N):
    """An anti-aliased superellipse-cornered square mask, `size` px."""
    big = size * SS
    mask = Image.new("L", (big, big), 0)
    d = ImageDraw.Draw(mask)
    r = radius_frac * big
    # Straight edges between the corners.
    d.rectangle([r, 0, big - r, big], fill=255)
    d.rectangle([0, r, big, big - r], fill=255)
    # Each corner is a quadrant of |x/r|^n + |y/r|^n = 1.
    steps = max(64, int(r))
    for cx, cy, sx, sy in (
        (r, r, -1, -1),
        (big - r, r, 1, -1),
        (big - r, big - r, 1, 1),
        (r, big - r, -1, 1),
    ):
        pts = [(cx, cy)]
        for i in range(steps + 1):
            t = i / steps
            x = t
            y = (1 - x**n) ** (1 / n)
            pts.append((cx + sx * x * r, cy + sy * y * r))
        d.polygon(pts, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def load_master():
    im = Image.open(MASTER).convert("RGBA")
    if im.width != im.height:
        side = min(im.size)
        left = (im.width - side) // 2
        top = (im.height - side) // 2
        im = im.crop((left, top, left + side, top + side))
    return im


def square(master, size):
    """Full-bleed: the art fills the canvas, corners left square."""
    return master.resize((size, size), Image.LANCZOS)


def rounded(master, size, content=MAC_CONTENT, radius=MAC_RADIUS):
    """The art masked into a rounded square, inset in a transparent canvas."""
    side = max(1, round(size * content))
    art = master.resize((side, side), Image.LANCZOS)
    art.putalpha(squircle_mask(side, radius))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    off = (size - side) // 2
    out.paste(art, (off, off), art)
    return out


def opaque(im, bg=(245, 243, 254)):
    """Flatten onto the artwork's own background -- iOS forbids an alpha channel."""
    flat = Image.new("RGB", im.size, bg)
    flat.paste(im, (0, 0), im)
    return flat


def write(im, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path)
    return path


def main():
    master = load_master()
    written = []

    # ── macOS ────────────────────────────────────────────────────────────────
    # `padded/` is the name the build and main.cjs already use: build.icon
    # reads icon-1024, and the packaged app ships icon-512 for the Dock.
    for s in (16, 32, 64, 128, 256, 512, 1024):
        written.append(write(rounded(master, s), "app-icons", "padded", f"icon-{s}.png"))

    # An .iconset that `iconutil` turns into icon.icns (see the npm script).
    for s in (16, 32, 128, 256, 512):
        written.append(
            write(rounded(master, s), "app-icons", "mac.iconset", f"icon_{s}x{s}.png")
        )
        written.append(
            write(
                rounded(master, s * 2),
                "app-icons",
                "mac.iconset",
                f"icon_{s}x{s}@2x.png",
            )
        )

    # macOS 26 draws an .icns as a "legacy" icon: anything already rounded is
    # shrunk onto a grey tile in the Apps view and Finder, while a full-bleed
    # square is rounded by the system.  It wants an Icon Composer `.icon` --
    # one full-bleed layer, no glass -- which electron-builder compiles with
    # Xcode's actool (mac.icon).  The rounded icon.icns above stays for macOS
    # 13-15, which round nothing: afterPack puts it back over actool's own
    # legacy .icns, which stops at 256 px.  Tested side by side in the Apps
    # view on macOS 26: rounded .icns tiled, square .icns and this .icon right.
    icon_dir = os.path.join(ROOT, "app-icons", "PurpleCAD.icon")
    written.append(
        write(opaque(square(master, 1024)), "app-icons", "PurpleCAD.icon", "Assets", "art.png")
    )
    icon_json = os.path.join(icon_dir, "icon.json")
    with open(icon_json, "w") as f:
        json.dump(
            {
                "groups": [
                    {
                        "layers": [{"image-name": "art.png", "name": "art", "glass": False}],
                        "shadow": {"kind": "none", "opacity": 0},
                        "translucency": {"enabled": False, "value": 0},
                    }
                ],
                "supported-platforms": {"squares": ["macOS"]},
            },
            f,
            indent=2,
        )
        f.write("\n")
    written.append(icon_json)

    # ── Windows ──────────────────────────────────────────────────────────────
    for s in (16, 24, 32, 48, 64, 96, 128, 256, 512, 1024):
        written.append(write(square(master, s), "app-icons", "windows", f"icon-{s}.png"))
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico = os.path.join(ROOT, "app-icons", "windows", "icon.ico")
    square(master, 256).save(ico, sizes=[(s, s) for s in ico_sizes])
    written.append(ico)

    # ── Linux ────────────────────────────────────────────────────────────────
    # electron-builder takes a DIRECTORY of square pngs named by their size.
    for s in (16, 32, 48, 64, 128, 256, 512, 1024):
        written.append(write(square(master, s), "app-icons", "linux", f"{s}x{s}.png"))

    # ── iOS ──────────────────────────────────────────────────────────────────
    ios = {
        "Icon-20.png": 20,
        "Icon-20@2x.png": 40,
        "Icon-20@3x.png": 60,
        "Icon-29.png": 29,
        "Icon-29@2x.png": 58,
        "Icon-29@3x.png": 87,
        "Icon-40.png": 40,
        "Icon-40@2x.png": 80,
        "Icon-40@3x.png": 120,
        "Icon-60@2x.png": 120,
        "Icon-60@3x.png": 180,
        "Icon-76.png": 76,
        "Icon-76@2x.png": 152,
        "Icon-83@2x.png": 167,
        "Icon-1024.png": 1024,
    }
    for name, s in ios.items():
        written.append(write(opaque(square(master, s)), "app-icons", "ios", name))

    # ── Browser tab ──────────────────────────────────────────────────────────
    # Rounded, but only lightly inset: a favicon is already tiny, and Apple's
    # Dock proportions would waste most of the 32px a tab actually shows.
    written.append(
        write(rounded(master, 256, content=0.98, radius=0.18), "public", "favicon.png")
    )

    print(f"wrote {len(written)} files from {os.path.relpath(MASTER, ROOT)}")


if __name__ == "__main__":
    main()
