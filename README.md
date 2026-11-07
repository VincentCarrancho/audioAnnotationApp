# aNotate

A macOS listening notebook for local audio recordings. Capture a marker with **M** while listening; pause to write through the focus queue. Drag a passage to select it and choose **Annotate selection** to create a range note. Notes use Editor.js; Save (⌘S) saves without completing the current item.

## Audio import

Choose **New project**, select audio, name the project and choose a parent folder. aNotate preserves an exact copy of the original recording and prepares a separate PCM WAV playback copy in the project folder; it does not modify the source. Preparation can take time and uses additional disk space. **Open project** selects an existing project folder. Keep the entire folder together when moving it; existing WAV-only projects remain compatible.

Import targets common local MP3, M4A/AAC, FLAC, OGG/Vorbis/Opus, AIFF, WAV and WMA recordings. Format support depends on the file's actual codec: protected, damaged or unsupported files may not import. Conversion runs offline using the bundled decoder; end users do not need to install a decoder. Bundling the decoder increases app size.

New playback copies use 32-bit float PCM, retaining the decoded stream's sample rate and channel count. The playback copy must remain below **2,000,000,000 bytes**; highly compressed or long recordings can exceed that limit when decoded. Oversized output is rejected rather than accepted as truncated. Failed creation can leave a partial project folder without `wavnotes.json`; the error identifies it for inspection. Choose a new name/location or inspect the partial folder before retrying.

Real packaged-decoder tests cover WAV, MP3, M4A, AAC, FLAC, Ogg Vorbis, Opus, AIFF and WMA v2. This is not a guarantee for every codec profile or DRM-protected recording.

## Appearance

The interface uses a neutral grayscale light palette, square controls, and locally bundled **Pixelify Sans** pixel/block typography. Font files, provenance, and the SIL Open Font License ship in `public/fonts/`; the app does not fetch fonts from a CDN.

## Run

Install Node.js and npm, Rust through [rustup](https://rustup.rs/), and the Apple Command Line Tools (`xcode-select --install`). Use macOS with the Tauri prerequisites installed.

```sh
npm install
npm run desktop:dev
```

```sh
npm run build         # typecheck and build frontend
npm run typecheck
npm test
npm run desktop:build # native release bundle
```

### Decoder provisioning and distribution

The Tauri development/build hooks automatically run `bash scripts/provision-decoder.sh`. The first developer build downloads checksum-pinned FFmpeg 7.1.1 source and compiles a self-contained LGPL-compatible decoder using the Apple build tools. Later builds reuse the generated decoder. End-user imports use the bundled executable, not Homebrew or a system FFmpeg installation, and require no network access.

The source checksum, license, and exact build configuration are in `third-party/ffmpeg/` and `scripts/provision-decoder.sh`; the package includes the notices and provisioning script. Generated decoder binaries and build caches are not committed. Before distributing binary releases, review corresponding-source availability and LGPL obligations. Current local bundles are ad-hoc signed, not notarized; signing/notarization remains a distribution step.

The format-conversion matrix is explicitly ignored in ordinary Rust tests because it requires encoded fixtures and a packaged app. To run the acceptance gate after building, use a developer FFmpeg encoder only to generate synthetic fixtures, then test the decoder from inside the app:

```sh
bash scripts/generate-decoder-fixtures.sh
ANOTATE_AUDIO_FIXTURES="$PWD/.decoder-cache/fixtures 音" \
ANOTATE_TEST_DECODER="$PWD/src-tauri/target/release/bundle/macos/aNotate.app/Contents/Resources/resources/ffmpeg" \
bash scripts/verify-audio-import.sh
```

`scripts/test-decoder-cache.sh --rebuild` exercises cache-substitution and pristine-source rebuild checks. Current packaged verification targets Apple Silicon; other architectures need their own decoder build and checks.

`npm run dev` starts a browser-only interface for iteration. It cannot create, open, or save native projects; the explicitly labelled preview uses a bundled two-second fixture and discards edits. It is not a native playback or persistence test.

## Working with notes

Outside editors and controls, **Space** plays or pauses, **← / →** seek five seconds, and **Z** zooms to the current selection. Shortcuts leave normal text editing and focused controls alone. When zoomed, the timeline follows playback while respecting manual scrolling and selection zoom.

Capture with M outside an editor, or use **Add marker**. Playback continues while capturing; pausing opens the first queued item. **Done → Next** completes an item, while **Skip for now** leaves it pending for a later pass. Normal playback during review does not move to another note. Select a marker or an item in the chronological note navigation to open it without seeking; use the explicit play or loop buttons to listen from it. Delete is separately undoable with **Undo delete** or ⌘Z (Ctrl+Z) outside an editor. The project note is independent of annotations.

Changes are autosaved after editing. A failed save remains visible and the app asks before discarding unsaved content on project switch or native close. The recording and notes are stored together in the project folder.
