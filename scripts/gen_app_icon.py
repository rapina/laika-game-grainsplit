"""
Resize the source app-icon artwork into every size the Android/Play Store/Toss
listings need. Source file: src/assets/app_icon/source_raw.png (regenerate via
`generate-image` skill if the art changes).

Outputs:
  src/assets/app_icon/
    playstore_512.png      512x512  Play Store high-res icon
    toss_600.png           600x600  Toss listing
    source_1024.png        1024x1024 upscaled master
  android/app/src/main/res/
    mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/
      ic_launcher.png            square legacy icon (48/72/96/144/192)
      ic_launcher_round.png      identical — system masks on round-shape devices
      ic_launcher_foreground.png adaptive foreground, content centered in safe
                                 area (66dp of 108dp) per density
                                 (108/162/216/324/432)
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src', 'assets', 'app_icon', 'source_raw.png')
ICON_OUT = os.path.join(ROOT, 'src', 'assets', 'app_icon')
MIPMAP_BASE = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')

# Legacy square icon sizes per density (mipmap-{density}/ic_launcher.png).
LAUNCHER_SIZES = {
    'mdpi':    48,
    'hdpi':    72,
    'xhdpi':   96,
    'xxhdpi':  144,
    'xxxhdpi': 192,
}
# Adaptive foreground sizes (108dp canvas * density DP scale).
FG_SIZES = {
    'mdpi':    108,
    'hdpi':    162,
    'xhdpi':   216,
    'xxhdpi':  324,
    'xxxhdpi': 432,
}
# Adaptive foreground safe area ratio — the system crops up to 21dp of the
# outer 108dp canvas depending on the mask shape. Content needs to fit in the
# inner 66dp ≈ 61% of the canvas.
FG_CONTENT_RATIO = 0.66


def save_square(img: Image.Image, size: int, path: str) -> None:
    """Resize to square `size` using nearest-neighbor (preserve pixel art)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out = img.resize((size, size), Image.NEAREST)
    out.save(path)
    print(f'  -> {path} ({size}x{size})')


def save_foreground(img: Image.Image, canvas_size: int, path: str) -> None:
    """Center content within a transparent canvas, sized for adaptive safe area."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    content_size = int(canvas_size * FG_CONTENT_RATIO)
    resized = img.resize((content_size, content_size), Image.NEAREST)
    canvas = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    offset = (canvas_size - content_size) // 2
    canvas.paste(resized, (offset, offset))
    canvas.save(path)
    print(f'  -> {path} ({canvas_size}x{canvas_size}, content {content_size})')


def main() -> None:
    if not os.path.exists(SRC):
        raise SystemExit(f'source not found: {SRC}')
    src = Image.open(SRC).convert('RGBA')
    print(f'source: {SRC}  ({src.size[0]}x{src.size[1]})')

    # Standalone listing icons (no rounding — each platform masks as it likes)
    save_square(src, 1024, os.path.join(ICON_OUT, 'source_1024.png'))
    save_square(src, 600,  os.path.join(ICON_OUT, 'toss_600.png'))
    save_square(src, 512,  os.path.join(ICON_OUT, 'playstore_512.png'))

    # Android launcher PNGs per density
    for density, size in LAUNCHER_SIZES.items():
        d = os.path.join(MIPMAP_BASE, f'mipmap-{density}')
        save_square(src, size, os.path.join(d, 'ic_launcher.png'))
        save_square(src, size, os.path.join(d, 'ic_launcher_round.png'))

    # Adaptive foreground per density (with safe-area padding)
    for density, size in FG_SIZES.items():
        d = os.path.join(MIPMAP_BASE, f'mipmap-{density}')
        save_foreground(src, size, os.path.join(d, 'ic_launcher_foreground.png'))

    print('done')


if __name__ == '__main__':
    main()
