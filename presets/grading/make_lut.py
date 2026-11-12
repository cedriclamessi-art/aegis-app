"""Genere la LUT d'etalonnage EFFUSION (.cube, 33^3).

Look "Raw Revival" : noir et blanc contraste, noirs profonds a #0B0B0B,
hautes lumieres creme #F4F1EA (les couleurs de la marque), courbe en S.
Usage : python3 make_lut.py [sortie.cube]
"""
import sys

SIZE = 33
BLACK = (0x0B / 255, 0x0B / 255, 0x0B / 255)   # #0B0B0B
CREAM = (0xF4 / 255, 0xF1 / 255, 0xEA / 255)   # #F4F1EA
CONTRAST = 0.55     # 0 = lineaire, 1 = tres contraste
GAMMA = 1.08        # >1 assombrit legerement les moyens tons


def s_curve(x):
    # smoothstep melangee a l'identite
    sm = x * x * (3 - 2 * x)
    return (1 - CONTRAST) * x + CONTRAST * sm


def grade(r, g, b):
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b    # luminance Rec.709
    y = s_curve(y) ** GAMMA
    return tuple(BLACK[i] + (CREAM[i] - BLACK[i]) * y for i in range(3))


def main(path):
    with open(path, "w") as f:
        f.write('TITLE "EFFUSION Raw Revival"\n')
        f.write(f"LUT_3D_SIZE {SIZE}\n")
        f.write("DOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n")
        # format .cube : le rouge varie le plus vite
        for bi in range(SIZE):
            for gi in range(SIZE):
                for ri in range(SIZE):
                    o = grade(ri / (SIZE - 1), gi / (SIZE - 1), bi / (SIZE - 1))
                    f.write(f"{o[0]:.6f} {o[1]:.6f} {o[2]:.6f}\n")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "effusion-raw-revival.cube")
