"""Render the Kinora app icon (PNG + multi-size ICO) into resources/.

The mark matches the in-app logo: a rounded violet→cyan gradient tile with a white play
triangle and a playhead bar. Drawn at 1024 px with supersampling, then downscaled.

    python scripts/make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "resources"
S = 1024  # master size


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def gradient_tile(size):
    """Diagonal three-stop gradient inside a rounded square."""
    stops = [(0.0, (169, 149, 255)), (0.55, (124, 92, 255)), (1.0, (34, 211, 238))]
    grad = Image.new("RGBA", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            for i in range(len(stops) - 1):
                t0, c0 = stops[i]
                t1, c1 = stops[i + 1]
                if t <= t1:
                    px[x, y] = lerp(c0, c1, (t - t0) / (t1 - t0)) + (255,)
                    break
    mask = Image.new("L", (size, size), 0)
    pad = round(size * 1 / 32)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, size - pad - 1, size - pad - 1], radius=round(size * 9 / 32), fill=255)
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile.paste(grad, (0, 0), mask)
    return tile


def mark(size):
    img = gradient_tile(size)
    d = ImageDraw.Draw(img)
    k = size / 32
    # Play triangle (matches the SVG path in the in-app logo).
    d.polygon([(12.2 * k, 9.3 * k), (24.6 * k, 16 * k), (12.2 * k, 22.7 * k)], fill=(255, 255, 255, 255))
    # Playhead bar.
    d.rounded_rectangle([7 * k, 9 * k, 9.6 * k, 23 * k], radius=1.3 * k, fill=(255, 255, 255, 184))
    return img


def main():
    OUT.mkdir(exist_ok=True)
    big = mark(S)
    big.resize((512, 512), Image.LANCZOS).save(OUT / "icon.png")
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    big.resize((256, 256), Image.LANCZOS).save(OUT / "icon.ico", sizes=[(s, s) for s in sizes])
    print("wrote", OUT / "icon.png", "and", OUT / "icon.ico")


if __name__ == "__main__":
    main()
