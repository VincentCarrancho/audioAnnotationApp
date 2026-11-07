#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION=7.1.1
SHA256=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1
CACHE="${DECODER_CACHE_DIR:-$ROOT/.decoder-cache}"
ARCHIVE="$CACHE/ffmpeg-$VERSION.tar.xz"
OUTPUT="${DECODER_OUTPUT:-$ROOT/src-tauri/resources/ffmpeg}"
STAMP="$CACHE/decoder-fingerprint"
MODE="${1:-build}"
[[ "$MODE" == build || "$MODE" == --check-cache ]] || { echo 'Usage: provision-decoder.sh [--check-cache]' >&2; exit 2; }
if [[ "$(uname -s)-$(uname -m)" != Darwin-arm64 ]]; then
  echo 'Decoder provisioning currently supports Apple Silicon macOS only.' >&2; exit 1
fi
mkdir -p "$CACHE"
digest() { shasum -a 256 "$1" | awk '{print $1}'; }
SCRIPT_HASH="$(digest "$ROOT/scripts/provision-decoder.sh")"
CLANG="$(xcrun --find clang)"
COMPILER_HASH="$(printf '%s\n%s\n%s\n' "$CLANG" "$("$CLANG" --version)" "$(xcrun --show-sdk-path)" | shasum -a 256 | awk '{print $1}')"
fingerprint() {
  printf 'script=%s\narchive=%s\ncompiler=%s\narchitecture=arm64\nbinary=%s\n' "$SCRIPT_HASH" "$SHA256" "$COMPILER_HASH" "$(digest "$1")"
}
verify_binary() {
  local bin="$1" line
  [[ -x "$bin" ]] || return 1
  lipo "$bin" -verify_arch arm64 || return 1
  # Only Apple system libraries/frameworks are allowed, never Homebrew dylibs.
  while IFS= read -r line; do
    case "$line" in /usr/lib/*|/System/Library/*) ;; *) return 1 ;; esac
  done < <(otool -L "$bin" | tail -n +2 | awk '{print $1}')
  local version
  version="$("$bin" -version)" || return 1
  [[ "$version" == *"ffmpeg version $VERSION "* ]] || return 1
  for line in --disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network --disable-shared --enable-static --disable-everything; do
    [[ "$version" == *"$line"* ]] || return 1
  done
}
cache_valid() {
  [[ -f "$ARCHIVE" && -f "$STAMP" && -x "$OUTPUT" ]] || return 1
  [[ "$(digest "$ARCHIVE")" == "$SHA256" ]] || return 1
  [[ "$(fingerprint "$OUTPUT")" == "$(cat "$STAMP")" ]] || return 1
  verify_binary "$OUTPUT"
}
if cache_valid; then echo 'Verified pinned decoder cache.'; exit 0; fi
if [[ "$MODE" == --check-cache ]]; then echo 'Decoder cache verification failed.' >&2; exit 1; fi
if [[ ! -f "$ARCHIVE" ]]; then
  curl -fL --retry 2 "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz" -o "$ARCHIVE.download"
  mv "$ARCHIVE.download" "$ARCHIVE"
fi
echo "$SHA256  $ARCHIVE" | shasum -a 256 -c -
# Always unpack verified source into a fresh private build directory on a cache
# miss; never compile a mutable, previously extracted source tree.
BUILD_DIR="$(mktemp -d "$CACHE/build.XXXXXXXX")"
trap 'rm -rf -- "$BUILD_DIR"' EXIT
tar -xJf "$ARCHIVE" -C "$BUILD_DIR"
cd "$BUILD_DIR/ffmpeg-$VERSION"
./configure --disable-gpl --disable-version3 --disable-nonfree --disable-autodetect \
  --disable-network --disable-shared --enable-static --disable-doc --disable-debug \
  --disable-everything --disable-ffplay --disable-ffprobe --disable-avdevice \
  --enable-ffmpeg --enable-protocol=file \
  --enable-demuxer=wav,mp3,mov,aac,flac,ogg,aiff,asf \
  --enable-decoder='pcm_*,mp3,mp3float,aac,aac_fixed,alac,flac,vorbis,opus,wmav1,wmav2,wmapro,wmalossless' \
  --enable-parser=aac,aac_latm,mpegaudio,flac,opus,vorbis \
  --enable-encoder=pcm_f32le --enable-muxer=wav \
  --enable-filter=aformat,aresample,anull
make -j "${DECODER_JOBS:-4}" ffmpeg
verify_binary "$PWD/ffmpeg" || { echo 'Built decoder failed architecture/config/linkage verification' >&2; exit 1; }
mkdir -p "$(dirname "$OUTPUT")"
install -m 755 ffmpeg "$OUTPUT"
fingerprint "$OUTPUT" > "$STAMP"
echo "Built $OUTPUT from verified FFmpeg $VERSION source (LGPL configuration)."
