#!/usr/bin/env bash
# Refresh the bundled ANAF kit from ANAF's official update channel.
#
# Usage:
#   tools/refresh-kit.sh            # refresh framework + D112 (default)
#   tools/refresh-kit.sh D112 D300  # refresh framework + listed declarations
#
# Downloads the current integrator framework (DUKIntegrator.jar, Validator.jar,
# DecValidation.jar, DecPdf.jar, iText/BouncyCastle libs) and config files into
# app/, and each declaration's validator/pdf jars into app/lib/.
set -euo pipefail

if [ $# -eq 0 ]; then
  set -- D112
fi

BASE="http://static.anaf.ro/static/10/Anaf/update5"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app"
TMP="$APP/.refresh-tmp"

rm -rf "$TMP"
mkdir -p "$TMP" "$APP/lib" "$APP/config"
cd "$TMP"

echo "Fetching version manifest..."
curl -fsS --max-time 60 -o versiuni.xml "$BASE/versiuni.xml"

INTEGRATOR_VERSION="$(grep -A1 "<integrator>" versiuni.xml | grep -oE "[0-9]+(\.[0-9]+)+" | head -1)"
echo "Framework version on ANAF channel: $INTEGRATOR_VERSION"

echo "Fetching framework jars..."
for u in \
  "zz9/DUKIntegrator.jar" \
  "ss8/Validator.jar" \
  "ss8/DecValidation.jar" \
  "ss8/DecPdf.jar" \
  "ii/iText-5.0.4.jar" \
  "ii/bcmail-jdk15-145.jar" \
  "ii/bcprov-jdk15-145.jar" ; do
  curl -fsS --max-time 180 -o "$(basename "$u")" "$BASE/$u"
  echo "  ok: $(basename "$u")"
done

echo "Fetching config files..."
for c in $(grep -oE "update5/cc2/[A-Za-z0-9_.]+" versiuni.xml | sort -u); do
  curl -fsS --max-time 60 -o "$(basename "$c")" "$BASE/cc2/$(basename "$c")"
  echo "  ok: $(basename "$c")"
done

for d in "$@"; do
  block="$(awk "/<${d}>/,/<\/${d}>/" versiuni.xml)"
  jurl="$(printf '%s' "$block" | grep -oE "<JURL>[^<]+" | sed 's|<JURL>||' || true)"
  purl="$(printf '%s' "$block" | grep -oE "<PURL>[^<]+" | sed 's|<PURL>||' || true)"
  jver="$(printf '%s' "$block" | grep -oE "<versiuneJ>[^<]+" | sed 's|<versiuneJ>||' || true)"
  pver="$(printf '%s' "$block" | grep -oE "<versiuneP>[^<]+" | sed 's|<versiuneP>||' || true)"
  if [ -z "$jurl" ]; then
    echo "!! declaration $d not found in ANAF manifest" >&2
    exit 1
  fi
  echo "Fetching $d (validator $jver, pdf $pver)..."
  curl -fsS --max-time 300 -o "${d}Validator.jar" "$jurl"
  curl -fsS --max-time 180 -o "${d}Pdf.jar" "$purl"
done

echo "Installing into app/ ..."
mv -f DUKIntegrator.jar "$APP/"
for f in Validator.jar DecValidation.jar DecPdf.jar iText-5.0.4.jar bcmail-jdk15-145.jar bcprov-jdk15-145.jar; do
  mv -f "$f" "$APP/lib/"
done
for f in "$@"; do
  mv -f "${f}Validator.jar" "${f}Pdf.jar" "$APP/lib/"
done
mv -f ./*.cfg config.properties "$APP/config/" 2>/dev/null || true

{
  echo "Refreshed from $BASE/versiuni.xml on $(date -u +"%Y-%m-%d %H:%M UTC")"
  echo "Framework: $INTEGRATOR_VERSION"
  for d in "$@"; do
    echo "$d: $(awk "/<${d}>/,/<\/${d}>/" versiuni.xml | tr -d '\n\t ' | grep -oE '<versiuneJ>[^<]+|<versiuneP>[^<]+' | tr '\n' ' ')"
  done
} > "$APP/KIT-VERSIONS.txt"

cd "$ROOT"
rm -rf "$TMP"
echo "Done. app/ is now current. Commit the change to ship it."
