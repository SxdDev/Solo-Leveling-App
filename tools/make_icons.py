"""Generates the app icons. Original artwork: an octagon system-frame (the app's panel
signature) enclosing a gold ascending chevron. Cyan = system, gold = progress. Same two-accent
law as the UI. Re-run with: python3 tools/make_icons.py"""

from PIL import Image, ImageDraw
import os

BG = (5, 7, 13, 255)
SYS = (55, 200, 255, 255)
SYS_DIM = (27, 94, 122, 255)
GOLD = (245, 195, 77, 255)

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)


def octagon(cx, cy, r, cut=0.29):
    """Octagon with 45-degree corner cuts — the panel clip-path, as a shape."""
    c = r * cut
    return [
        (cx - r + c, cy - r), (cx + r - c, cy - r),
        (cx + r, cy - r + c), (cx + r, cy + r - c),
        (cx + r - c, cy + r), (cx - r + c, cy + r),
        (cx - r, cy + r - c), (cx - r, cy - r + c),
    ]


def render(size, padding_ratio=0.14):
    S = size * 4  # supersample
    img = Image.new('RGBA', (S, S), BG)
    d = ImageDraw.Draw(img)

    # Cool grain: a soft cyan bloom top-left, matching the app body::before.
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i in range(28):
        a = int(10 - i * 0.34)
        if a <= 0:
            break
        rr = int(S * 0.30 + i * S * 0.016)
        gd.ellipse([S * 0.18 - rr, S * 0.12 - rr, S * 0.18 + rr, S * 0.12 + rr], fill=(55, 200, 255, a))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)

    cx = cy = S // 2
    r = int(S * (0.5 - padding_ratio))

    # Outer system frame.
    d.line(octagon(cx, cy, r) + [octagon(cx, cy, r)[0]], fill=SYS_DIM, width=max(2, S // 90))
    d.line(octagon(cx, cy, int(r * 0.985)) + [octagon(cx, cy, int(r * 0.985))[0]],
           fill=SYS, width=max(2, S // 120))

    # The corner tick — the recurring mark. Top-left, exactly as in the UI.
    tick = int(r * 0.30)
    w = max(3, S // 70)
    top_left = octagon(cx, cy, r)[0]
    left_top = octagon(cx, cy, r)[7]
    d.line([top_left, (top_left[0] + tick, top_left[1])], fill=SYS, width=w)
    d.line([left_top, (left_top[0], left_top[1] + tick)], fill=SYS, width=w)

    # Gold ascending chevron: three rising strokes. Progress, not decoration.
    stroke = max(4, int(S * 0.055))
    base_y = cy + int(r * 0.42)
    for i, scale in enumerate([1.0, 0.72, 0.44]):
        span = int(r * 0.62 * scale)
        y = base_y - int(i * r * 0.36)
        peak = y - int(r * 0.30 * scale)
        d.line([(cx - span, y), (cx, peak), (cx + span, y)],
               fill=GOLD if i == 2 else (245, 195, 77, 190 - i * 30),
               width=stroke, joint='curve')

    return img.resize((size, size), Image.LANCZOS)


def maskable(size):
    """Maskable needs heavy padding — Android crops to a circle."""
    return render(size, padding_ratio=0.26)


for name, img in [
    ('icon-192.png', render(192)),
    ('icon-512.png', render(512)),
    ('apple-touch-icon.png', render(180, padding_ratio=0.10)),
    ('maskable-512.png', maskable(512)),
]:
    img.save(os.path.join(OUT, name))
    print('wrote', name)
