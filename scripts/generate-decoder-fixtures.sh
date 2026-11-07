#!/bin/bash
# Test-fixture generation only; this executable is never shipped or used to decode imports.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENCODER="${FIXTURE_ENCODER:-/opt/homebrew/bin/ffmpeg}"
DIR="$ROOT/.decoder-cache/fixtures 音"
mkdir -p "$DIR"
for item in 'wav:pcm_s16le' 'mp3:libmp3lame' 'm4a:aac' 'aac:aac' 'flac:flac' 'ogg:libvorbis' 'opus:libopus' 'aiff:pcm_s16be' 'wma:wmav2'; do
  extension="${item%%:*}"; codec="${item#*:}"
  "$ENCODER" -nostdin -hide_banner -loglevel error -y -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=2' -ac 2 -c:a "$codec" "$DIR/source 音.$extension"
done
"$ENCODER" -nostdin -hide_banner -loglevel error -y -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=2' -ac 2 -c:a libmp3lame -f wav "$DIR/source 音.mp3.wav"
"$ENCODER" -nostdin -hide_banner -loglevel error -y -f lavfi -i 'color=black:size=16x16:duration=1' -c:v mpeg4 "$DIR/no audio.mp4"
echo "$DIR"
