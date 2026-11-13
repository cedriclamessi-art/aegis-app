#!/usr/bin/env bash
# EFFUSION - export d'une video : etalonnage (LUT) + formats reseaux.
# Usage : ./effusion_export.sh video.mp4 [dossier_sortie] [--sans-lut]
# Sorties : <nom>_vertical.mp4 (1080x1920) et <nom>_youtube.mp4 (1920x1080)
set -euo pipefail

IN="${1:?Usage: $0 video.mp4 [dossier_sortie] [--sans-lut]}"
OUT="${2:-exports}"
HERE="$(cd "$(dirname "$0")" && pwd)"
LUT="$HERE/../grading/effusion-raw-revival.cube"
NAME="$(basename "${IN%.*}")"
mkdir -p "$OUT"

GRADE=""
if [[ "${3:-}" != "--sans-lut" ]]; then
  GRADE=",lut3d=file=${LUT}"
fi

ENC=(-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart)

# Vertical 9:16 : recadrage centre
ffmpeg -v error -y -i "$IN" \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920${GRADE}" \
  "${ENC[@]}" "$OUT/${NAME}_vertical.mp4"

# YouTube 16:9 : bandes noires #0B0B0B si le format differe
ffmpeg -v error -y -i "$IN" \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0B0B0B${GRADE}" \
  "${ENC[@]}" "$OUT/${NAME}_youtube.mp4"

echo "OK -> $OUT/${NAME}_vertical.mp4 et $OUT/${NAME}_youtube.mp4"
