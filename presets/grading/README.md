# Etalonnage EFFUSION - "Raw Revival"

`effusion-raw-revival.cube` : LUT 3D (33x33x33) noir et blanc contraste.
Noirs profonds `#0B0B0B`, hautes lumieres creme `#F4F1EA`, courbe en S.
Regenerer ou ajuster (CONTRAST, GAMMA) : `python3 make_lut.py`.

## Utilisation
- **DaVinci Resolve** : Color > LUTs, copier le .cube dans le dossier LUT, clic droit sur le noeud > LUT.
- **Premiere Pro** : Lumetri > Creative > Look > Parcourir.
- **CapCut / Lightroom** : importer le .cube comme LUT / profil.
- **ffmpeg** : `ffmpeg -i in.mp4 -vf "lut3d=file=effusion-raw-revival.cube" -c:a copy out.mp4`

Conseil : exposer correctement avant la LUT ; elle accentue les contrastes et ecrase les noirs.
Le pas de couleur (orange `#FF5A1F`) se rajoute ensuite en habillage (titres, boutons), pas dans l'etalonnage.
