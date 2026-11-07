#!/bin/bash
# Exercise cache validation in a disposable copy; never replace the real decoder.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMP="$(mktemp -d "${TMPDIR:-/tmp}/anotate-cache-test.XXXXXXXX")"
trap 'rm -rf -- "$TEMP"' EXIT
cp "$ROOT/.decoder-cache/ffmpeg-7.1.1.tar.xz" "$TEMP/ffmpeg-7.1.1.tar.xz"
cp "$ROOT/.decoder-cache/decoder-fingerprint" "$TEMP/decoder-fingerprint"
cp "$ROOT/src-tauri/resources/ffmpeg" "$TEMP/ffmpeg"
export DECODER_CACHE_DIR="$TEMP" DECODER_OUTPUT="$TEMP/ffmpeg"
bash "$ROOT/scripts/provision-decoder.sh" --check-cache
cp /opt/homebrew/bin/ffmpeg "$TEMP/ffmpeg"
if bash "$ROOT/scripts/provision-decoder.sh" --check-cache; then echo 'Substituted decoder was accepted' >&2; exit 1; fi
cp "$ROOT/src-tauri/resources/ffmpeg" "$TEMP/ffmpeg"
printf 'corruption' >> "$TEMP/ffmpeg-7.1.1.tar.xz"
if bash "$ROOT/scripts/provision-decoder.sh" --check-cache; then echo 'Modified archive was accepted' >&2; exit 1; fi
echo 'Decoder cache substitution and archive corruption were rejected.'
if [[ "${1:-}" == --rebuild ]]; then
  cp "$ROOT/.decoder-cache/ffmpeg-7.1.1.tar.xz" "$TEMP/ffmpeg-7.1.1.tar.xz"
  mkdir -p "$TEMP/ffmpeg-7.1.1"
  printf '#!/bin/sh\ntouch "%s"\nexit 1\n' "$TEMP/modified-tree-ran" > "$TEMP/ffmpeg-7.1.1/configure"
  chmod +x "$TEMP/ffmpeg-7.1.1/configure"
  printf 'force cache miss\n' > "$TEMP/decoder-fingerprint"
  bash "$ROOT/scripts/provision-decoder.sh"
  [[ ! -e "$TEMP/modified-tree-ran" ]] || { echo 'Modified cached source was executed' >&2; exit 1; }
  bash "$ROOT/scripts/provision-decoder.sh" --check-cache
  echo 'Cache miss rebuilt from the verified archive, not the modified cached tree.'
fi
