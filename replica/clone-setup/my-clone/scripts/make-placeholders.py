#!/usr/bin/env python3
"""Generates placeholder SVG images into public/. Overwrite any file with your own photo (same name, or change src/data/images.ts)."""
import os
ROOT = os.path.join(os.path.dirname(__file__), "..", "public")
PALETTES = [("#fecdd3", "#fde68a"), ("#bae6fd", "#a7f3d0"), ("#ddd6fe", "#fbcfe8"), ("#fed7aa", "#fef08a"), ("#bbf7d0", "#a5f3fc")]

def svg(w, h, label, i, circle=False):
    a, b = PALETTES[i % len(PALETTES)]
    shape = f'<circle cx="{w/2}" cy="{h/2}" r="{min(w,h)/2}" fill="url(#g)"/>' if circle else f'<rect width="{w}" height="{h}" fill="url(#g)"/>'
    fs = max(14, int(min(w, h) / 18))
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient></defs>
{shape}
<text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="{fs}" fill="#525252">{label}</text>
</svg>
'''

files = {}
files["images/hero.svg"] = (1600, 900, "Hero image", 0, False)
for n in range(1, 5): files[f"images/product-main-{n}.svg"] = (1200, 1200, f"Main product photo {n}", n, False)
for n in range(1, 4): files[f"images/product-accessory-{n}.svg"] = (1200, 1200, f"Accessory photo {n}", n + 1, False)
for n in range(1, 4): files[f"images/lifestyle-{n}.svg"] = (1200, 900, f"Lifestyle photo {n}", n + 2, False)
for n in range(1, 3): files[f"images/about-{n}.svg"] = (1200, 900, f"About photo {n}", n + 3, False)
for n in range(1, 7): files[f"images/avatar-{n}.svg"] = (160, 160, f"Customer {n}", n, True)
files["images/logo.svg"] = None
files["seo/og.svg"] = (1200, 630, "Share image (replace with 1200x630 PNG)", 1, False)

for rel, spec in files.items():
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if spec is None:
        open(path, "w").write('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40" viewBox="0 0 160 40"><text x="0" y="30" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="#171717">BRAND</text></svg>\n')
    else:
        open(path, "w").write(svg(*spec))

open(os.path.join(ROOT, "seo/favicon.svg"), "w").write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#171717"/><text x="32" y="43" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="#fff">B</text></svg>\n')
print(len(files) + 1, "files written")
