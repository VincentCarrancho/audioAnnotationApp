#!/bin/bash
# Explicit acceptance gate; fixtures are generated separately, never silently skipped.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${ANOTATE_AUDIO_FIXTURES:?Set ANOTATE_AUDIO_FIXTURES to the generated fixture directory}"
: "${ANOTATE_TEST_DECODER:?Set ANOTATE_TEST_DECODER to the decoder inside the packaged aNotate.app}"
[[ -d "$ANOTATE_AUDIO_FIXTURES" && -x "$ANOTATE_TEST_DECODER" ]] || { echo 'Fixture directory or executable decoder missing' >&2; exit 1; }
case "$ANOTATE_TEST_DECODER" in /*.app/Contents/Resources/resources/ffmpeg) ;; *) echo 'ANOTATE_TEST_DECODER must be an absolute path inside a packaged .app' >&2; exit 1 ;; esac
cargo test --manifest-path "$ROOT/src-tauri/Cargo.toml" bundled_decoder_converts_fixture_matrix -- --ignored --nocapture
