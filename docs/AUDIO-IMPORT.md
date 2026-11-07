# aNotate: branding and broad audio import

User-approved follow-up to the first prototype. Product requirements remain in PLAN.md; this file defines the implementation handoff for this change.

## Approved outcome

- Display the exact name **aNotate** in the app, window, package, and current documentation.
- Keep the GitHub repository/workspace location and stable bundle identifier. Preserve all existing project data, IDs, notes, queue order, and timestamps.
- Work offline without a separately installed decoder. Bundle a self-contained FFmpeg build, preserve an exact copy of the selected original, and create a separate WAV for playback.
- Target MP3, AAC/M4A, FLAC, OGG/Vorbis/Opus, AIFF, WAV, and common WMA variants. Clearly distinguish tested fixtures from codec capability listings, and do not advertise support for DRM, damaged files, or every proprietary codec.
- The user accepted added import time, disk usage, and application size.

## Shared seams and compatibility

- Generic create argument: `sourceAudioPath`, replacing the internal WAV-specific name. Picker helper: `chooseSourceAudio`.
- Keep version 1 `wavnotes.json` and `recording.relativePath` for playback. Add optional `recording.original: { relativePath: string; name: string }` for newly imported originals. Legacy projects omit that field and must still open/save without rewriting or duplicating their recording.
- New playback remains `recording.wav`; the original lives in a separate project-relative location. Both references require traversal/symlink validation; only the playback file needs webview asset access. Preserve the original metadata during saves.
- Keep conversion inside a native import module rather than spreading decoder details through the domain or timeline. Record actual PCM precision, sample-rate/channel handling, duration behavior, and large-file limits in its handoff.
- Create imports off the UI thread. Use fixed process argument arrays and app-bundled absolute executable paths, not a shell or PATH-based decoder fallback. Restrict decoder protocols/inputs to local audio and select an audio stream explicitly.
- No user files or pre-existing project folder may be overwritten. Failed import must leave no apparently complete project; clearly report any retained partial folder. Conversion, missing decoder, unsupported audio, and disk-space errors must be actionable.

## Ownership and sequencing

The orchestrator delegates all code/tests/configuration to `openrouter/openai/gpt-6.1-terra` agents.

1. **UI/branding agent** owns `src/App.tsx`, `src/app/**`, `src/style.css`, `index.html`, `package.json`, `package-lock.json`, and `README.md`. Use generic audio selection/import copy, explain preparation, preserve original filenames with non-WAV extensions, update tests, and apply aNotate branding. Add no decoder implementation here.
2. **Native/import agent** owns `src-tauri/**`, `src/persistence/**`, `src/contracts/project.ts`, `src/contracts/persistence.ts`, `.gitignore` (generated decoder/cache exclusions), and new decoder build/provision scripts and notices. Apply native product/window branding while preserving bundle identity. Implement generic picker/repository, compatible original metadata, offline conversion, and packaged decoder resolution. Own Tauri build-hook changes; request npm-hook changes through the orchestrator/UI owner.
3. After both release ownership, commission read-only verification and delegate any integration fixes to an explicit owner. Run automated frontend/native checks and build the packaged app.

Do not distribute this machine's Homebrew FFmpeg: it is GPL-enabled and dynamically linked. Prefer a pinned, reproducible LGPL-compatible self-contained build from a trusted source, with required notices, build configuration, and corresponding-source availability. Report actual provenance/license/linkage rather than assuming a downloaded executable is suitable. Do not commit large tool binaries or build caches without deliberate justification; the build/provisioning path must reproduce the local packaged result.

## Acceptance gates

- Existing fixture project from the first prototype opens, edits, saves, and moves with unchanged notes/queue/timestamps.
- Real conversion tests for each target family use the bundled decoder, not Homebrew/PATH. Original bytes match; playback copy decodes and duration/timing remains appropriate.
- Corrupt/no-audio/unsupported input, absent decoder, paths with spaces/Unicode, and an existing project destination fail safely. No network decoding or shell interpolation.
- Format tests verify preservation of sample rate/channels or document any deliberate conversion; long or oversized output must fail clearly instead of producing a truncated WAV.
- Verify the packaged decoder exists at its resolved path, launches without Homebrew libraries, and has appropriate executable permissions and license material.
- Frontend tests, typecheck, Rust tests/formatting, and macOS package build pass. Browser preview remains explicitly nonpersistent.
- Native project import/playback/save/reopen and full app quit/relaunch are checked in the actual aNotate build. Clearly identify manual checks that cannot be automated here.

## Progress

- [x] User approved name and original-plus-playback-copy approach.
- [x] UI/branding and native import implementation.
- [x] Independent review and automated conversion/compatibility checks.
- [x] Packaged build and native acceptance handoff (interactive user acceptance remains ongoing).
- [x] Old installed `/Applications/wavNotes.app` moved to Trash after the replacement was ready. Workspace and saved projects were preserved.

### Handoffs

- All implementation ownership is released. Tauri hooks provision the decoder automatically; README documents provisioning, playback-size limits, fixture gates, and distribution requirements.
- After review fixes and the [UI/UX pass](UX-PASS.md), the orchestrator reran 112 frontend tests, TypeScript checks, and all 23 Rust tests with the format matrix explicitly enabled. The final packaged decoder passed ten fixtures: WAV, MP3, M4A, AAC, FLAC, Vorbis, Opus, AIFF, WMA v2, and MP3-compressed WAV.
- Tests cover exact originals, duration/rate/channels, legacy/moved projects, safe failures, truncated WAV rejection, complete odd-length WAV acceptance, and original-filename preservation. The output-limit test uses a sparse file, not a real multi-gigabyte conversion.
- The decoder is arm64 and links only macOS system libraries. Cache substitution, modified-source, and archive checks were tested by the implementer. Packaging now explicitly ad-hoc signs the app; strict verification passed before and after installation. Signing/notarization and LGPL corresponding-source obligations still need review before public binary distribution.
- `/Applications/aNotate.app` was updated and launched; the old wavNotes app and previous aNotate build were preserved in Trash. Source/projects were untouched. Interactive native import/playback/quit acceptance remains a user feedback task, not an automated claim.
