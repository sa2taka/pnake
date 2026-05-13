#!/usr/bin/env bash
# Annotate Playwright-captured screenshots with numbered callouts for
# the README. Idempotent — overwrites the outputs each run.
#
# Requires: ImageMagick 7+ (`magick` command).
set -euo pipefail

cd "$(dirname "$0")/.."
IMG=docs/images

if ! command -v magick >/dev/null 2>&1; then
  echo "annotate.sh: ImageMagick (magick) not found — skipping. Install via:"
  echo "  brew install imagemagick"
  exit 0
fi

# Drop the duplicate 03 — Objects is the default tree view, so 02 already
# shows it. Keeping both in docs would be visual noise.
rm -f "$IMG/03-objects-view.png"

# ---- Hero shot: number each panel ----
#
# 02-loaded.png is 1600×1000. The 4 panels we want to call out:
#   1  Tree   — left rail   (~x=20,  y=80)
#   2  Render — center      (~x=420, y=80)
#   3  Detail — right rail  (~x=1380,y=80)
#   4  Drawer — bottom (toggle button) (~x=1450, y=20)

# Pick a usable bold font — ImageMagick on macOS doesn't auto-discover
# system fonts, so we hand it a path.
FONT=""
for candidate in \
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf" \
  "/System/Library/Fonts/SFNS.ttf" \
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"; do
  if [ -f "$candidate" ]; then FONT="$candidate"; break; fi
done

magick "$IMG/02-loaded.png" \
  ${FONT:+-font "$FONT"} \
  -pointsize 28 \
  -fill "#00d4aa" -strokewidth 0 \
  -draw "circle 40,100 40,128" \
  -draw "circle 440,100 440,128" \
  -draw "circle 1400,100 1400,128" \
  -draw "circle 1470,40 1470,68" \
  -fill black -annotate +33+110 "1" \
  -fill black -annotate +433+110 "2" \
  -fill black -annotate +1393+110 "3" \
  -fill black -annotate +1463+50 "4" \
  "$IMG/hero.png"

# ---- Smaller helper: scale a couple of shots down for inline use ----
# README inline images render best around 1200px wide. Anything beyond
# is fine but eats bandwidth on the GitHub view.
for src in 02-loaded 04-pages-view 05-content-view 06-structure-view 07-bottom-drawer hero; do
  [ -f "$IMG/$src.png" ] || continue
  magick "$IMG/$src.png" -resize 1200x "$IMG/$src.png"
done

echo "annotate.sh: $(ls -1 "$IMG"/*.png | wc -l | tr -d ' ') images ready in $IMG"
