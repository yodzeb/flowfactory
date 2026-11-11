# Render PNG app icons (same design as icons/icon.svg). Usage: python3 tools/make_icons.py
from PIL import Image, ImageDraw
import math, os

def icon(size, maskable=False):
    S = 4 * size  # supersample
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    bg = (21, 24, 29, 255)
    if maskable:
        d.rectangle([0, 0, S, S], fill=bg)
        k, o = 0.72, S * 0.14
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=bg)
        k, o = 1.0, 0
    f = lambda v: o + v / 512 * S * k
    w = lambda v: v / 512 * S * k
    d.line([f(80), f(320), f(432), f(320)], fill=(44, 50, 59), width=int(w(34)))
    for x, col in ((150, (76, 201, 176)), (250, (240, 138, 108))):
        r = w(44); d.ellipse([f(x) - r, f(320) - r, f(x) + r, f(320) + r], fill=col)
    cx, cy, r = f(368), f(308), w(76)
    d.polygon([(cx + r * math.cos(math.pi / 6 + i * math.pi / 3), cy + r * math.sin(math.pi / 6 + i * math.pi / 3)) for i in range(6)], fill=(242, 193, 78))
    d.line([f(130), f(190), f(300), f(190)], fill=(52, 105, 101), width=int(w(14)))
    return im.resize((size, size), Image.LANCZOS)

here = os.path.join(os.path.dirname(__file__), '..', 'icons')
icon(192).save(os.path.join(here, 'icon-192.png'))
icon(512).save(os.path.join(here, 'icon-512.png'))
icon(512, True).save(os.path.join(here, 'maskable-512.png'))
print('ok')
