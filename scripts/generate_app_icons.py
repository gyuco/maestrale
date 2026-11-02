#!/usr/bin/env python3
"""Generate every launcher/app icon used by the Maestrale Flutter client.

The artwork is generated from two versioned masters:

* ``app/assets/images/maestrale_app_icon.png`` — opaque 1254x1254 artwork.
* ``app/assets/images/maestrale_app_icon_foreground.png`` — 432x432 RGBA
  cut-out used as the Android adaptive-icon foreground.

Running the script rewrites, for every platform:

* Android: adaptive foreground/monochrome, legacy square and round launchers.
* iOS: AppIcon set (opaque PNGs, as required by the App Store).
* macOS: AppIcon set (rounded body, transparent margin and soft shadow).
* Web: favicon plus PWA icons, including maskable variants.
* Windows: multi-resolution ``app_icon.ico``.

Usage::

    python3 scripts/generate_app_icons.py

Requires Pillow (``python3 -m pip install pillow``).
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"

APP_ICON = APP / "assets/images/maestrale_app_icon.png"
APP_ICON_FOREGROUND = APP / "assets/images/maestrale_app_icon_foreground.png"

# Launcher icon sizes per Android density bucket.
ANDROID_LEGACY = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}
# Adaptive foreground lives on a 108dp canvas.
ANDROID_FOREGROUND = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}

# Artwork must stay inside the adaptive-icon safe zone (66dp of 108dp).
ANDROID_CONTENT_RATIO = 0.62
# Big Sur-style macOS icons keep a transparent margin around the rounded body.
MACOS_BODY_RATIO = 0.80
MACOS_CORNER_RATIO = 0.2237
WINDOWS_BODY_RATIO = 0.92
WINDOWS_CORNER_RATIO = 0.18

WINDOWS_ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def _resize(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def _rounded_mask(size: int, radius_ratio: float, supersample: int = 4) -> Image.Image:
    """Anti-aliased rounded-square alpha mask."""
    big = size * supersample
    mask = Image.new("L", (big, big), 0)
    radius = max(1, round(big * radius_ratio))
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, big - 1, big - 1), radius=radius, fill=255
    )
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def _circle_mask(size: int, supersample: int = 4) -> Image.Image:
    big = size * supersample
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def _save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)


def _square_rgba(image: Image.Image, size: int) -> Image.Image:
    """Opaque full-bleed image (no alpha channel)."""
    return _resize(image.convert("RGB"), size)


def _rounded_square(image: Image.Image, size: int, body_ratio: float, corner_ratio: float) -> Image.Image:
    body = max(1, round(size * body_ratio))
    offset = (size - body) // 2
    artwork = _resize(image.convert("RGB"), body).convert("RGBA")
    artwork.putalpha(_rounded_mask(body, corner_ratio))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(artwork, (offset, offset))
    return canvas


def _circle(image: Image.Image, size: int) -> Image.Image:
    artwork = _resize(image.convert("RGB"), size).convert("RGBA")
    artwork.putalpha(_circle_mask(size))
    return artwork


def _foreground_layer(foreground: Image.Image, size: int) -> Image.Image:
    """Centre the cut-out artwork inside the adaptive-icon safe zone."""
    opaque = foreground.getchannel("A").point(lambda alpha: 255 if alpha > 8 else 0)
    bbox = opaque.getbbox() or (0, 0, *foreground.size)
    artwork = foreground.crop(bbox)
    target = max(1, round(size * ANDROID_CONTENT_RATIO))
    scale = target / max(artwork.size)
    width = max(1, round(artwork.width * scale))
    height = max(1, round(artwork.height * scale))
    artwork = artwork.resize((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(artwork, ((size - width) // 2, (size - height) // 2))
    return canvas


def _monochrome(layer: Image.Image) -> Image.Image:
    """Android 13 themed icon: the alpha channel is used as the mask."""
    mono = Image.new("RGBA", layer.size, (255, 255, 255, 0))
    mono.putalpha(layer.getchannel("A"))
    return mono


def _macos_icon(image: Image.Image, size: int) -> Image.Image:
    body = max(1, round(size * MACOS_BODY_RATIO))
    offset = (size - body) // 2
    mask = _rounded_mask(body, MACOS_CORNER_RATIO)

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_mask = mask.filter(ImageFilter.GaussianBlur(max(0.6, size * 0.012)))
    shadow_body = Image.new("RGBA", (body, body), (4, 24, 78, 0))
    shadow_body.putalpha(shadow_mask.point(lambda alpha: round(alpha * 0.35)))
    shadow.alpha_composite(
        shadow_body, (offset, offset + max(1, round(size * 0.01)))
    )

    artwork = _resize(image.convert("RGB"), body).convert("RGBA")
    artwork.putalpha(mask)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(artwork, (offset, offset))
    return canvas


def _generate_android(master: Image.Image, foreground: Image.Image) -> list[Path]:
    res = APP / "android/app/src/main/res"
    written: list[Path] = []

    for density, size in ANDROID_LEGACY.items():
        square = res / f"mipmap-{density}/ic_launcher.png"
        _save_png(_square_rgba(master, size), square)
        written.append(square)

        round_icon = res / f"mipmap-{density}/ic_launcher_round.png"
        _save_png(_circle(master, size), round_icon)
        written.append(round_icon)

    for density, size in ANDROID_FOREGROUND.items():
        layer = _foreground_layer(foreground, size)
        foreground_path = res / f"drawable-{density}/ic_launcher_foreground.png"
        _save_png(layer, foreground_path)
        written.append(foreground_path)

        mono_path = res / f"drawable-{density}/ic_launcher_monochrome.png"
        _save_png(_monochrome(layer), mono_path)
        written.append(mono_path)

    return written


def _generate_ios(master: Image.Image) -> list[Path]:
    folder = APP / "ios/Runner/Assets.xcassets/AppIcon.appiconset"
    contents = json.loads((folder / "Contents.json").read_text())
    written: list[Path] = []

    for entry in contents["images"]:
        filename = entry.get("filename")
        if not filename:
            continue
        base = float(entry["size"].split("x")[0])
        scale = int(entry["scale"].rstrip("x"))
        path = folder / filename
        # The App Store rejects icons with an alpha channel.
        _save_png(_square_rgba(master, round(base * scale)), path)
        written.append(path)

    return written


def _generate_macos(master: Image.Image) -> list[Path]:
    folder = APP / "macos/Runner/Assets.xcassets/AppIcon.appiconset"
    contents = json.loads((folder / "Contents.json").read_text())
    written: list[Path] = []

    for entry in contents["images"]:
        filename = entry.get("filename")
        if not filename:
            continue
        base = float(entry["size"].split("x")[0])
        scale = int(entry["scale"].rstrip("x"))
        path = folder / filename
        _save_png(_macos_icon(master, round(base * scale)), path)
        written.append(path)

    return written


def _generate_web(master: Image.Image) -> list[Path]:
    web = APP / "web"
    icons = web / "icons"
    written: list[Path] = []

    favicon = web / "favicon.png"
    _save_png(_square_rgba(master, 32), favicon)
    written.append(favicon)

    for size in (192, 512):
        path = icons / f"Icon-{size}.png"
        _save_png(_square_rgba(master, size), path)
        written.append(path)

        # The full-bleed artwork already keeps every subject inside the
        # maskable safe circle, so the maskable variant is the same image.
        maskable = icons / f"Icon-maskable-{size}.png"
        _save_png(_square_rgba(master, size), maskable)
        written.append(maskable)

    return written


def _generate_windows(master: Image.Image) -> list[Path]:
    path = APP / "windows/runner/resources/app_icon.ico"
    path.parent.mkdir(parents=True, exist_ok=True)
    icon = _rounded_square(
        master, 256, WINDOWS_BODY_RATIO, WINDOWS_CORNER_RATIO
    )
    icon.save(path, format="ICO", sizes=[(s, s) for s in WINDOWS_ICO_SIZES])
    return [path]


def main() -> None:
    master = Image.open(APP_ICON).convert("RGB")
    foreground = Image.open(APP_ICON_FOREGROUND).convert("RGBA")

    groups = {
        "android": _generate_android(master, foreground),
        "ios": _generate_ios(master),
        "macos": _generate_macos(master),
        "web": _generate_web(master),
        "windows": _generate_windows(master),
    }

    total = 0
    for platform, paths in groups.items():
        total += len(paths)
        print(f"{platform:8s} {len(paths):3d} file")
    print(f"{'total':8s} {total:3d} file")


if __name__ == "__main__":
    main()
