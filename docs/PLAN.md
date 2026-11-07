# aNotate design

This document records the user-approved prototype requirements. Unresolved questions are not requirements.
The prototype, aNotate/audio-import follow-up, and first UI/UX pass are implemented and installed; native user acceptance remains ongoing. Follow-up verification is in [AUDIO-IMPORT.md](AUDIO-IMPORT.md) and [UX-PASS.md](UX-PASS.md). Initial build sequencing is in [BUILD.md](BUILD.md).

## Purpose and scope

- Personal, macOS-first desktop listening notebook.
- User-written observations, not automated musical analysis or assessment.
- No music-theory knowledge or structured musical categories required.
- One recording per project.
- Approved stack: Tauri, React + TypeScript with Vite, WaveSurfer.js, and Editor.js.
- App name: **aNotate**. Preserve existing projects, app installation identity, workspace location, and GitHub remote during the branding change.
- Import common local audio formats offline through bundled FFmpeg: tested targets are MP3, M4A/AAC, FLAC, OGG/Vorbis/Opus, AIFF, WAV, and common WMA variants. Unsupported, damaged, or protected files produce clear errors; literal support for every proprietary/DRM format is not promised.
- Preserve an exact original copy and create a separate WAV playback copy. The user accepted extra disk usage and import time in exchange for consistent playback and no end-user decoder installation.

## Appearance

- Fixed light-mode styling with neutral grayscale colors only: white/light-gray surfaces, dark text, and gray borders, waveform, selection, and focus states.
- Apply the palette consistently to the welcome screen, project controls, notes/Editor.js tools, queue, transport, annotation handles, banners, and error/save states. Preserve clear contrast and explicit status labels without colored accents.
- Preserve layout, typography, annotation behavior, and keyboard controls. No theme toggle or unrelated redesign is requested.

## Project creation

- New project → choose audio → choose project name and location → preserve the original and prepare the playback copy → open the timeline.
- Establish the save location before listening so the first capture can be persisted immediately.

## Notes and timeline

- Point annotations attach formatted notes to a timestamp.
- Range annotations attach formatted notes to a start/end passage.
- Multiple independent annotations may share a timestamp or overlap.
- Each annotation has one formatted note body; markers are not containers for separate notes.
- A separate project note holds whole-recording observations.
- Annotation handles stack automatically when they collide visually and unstack as zoom creates room. There are no manually managed layers.
- A range annotation's start/end handles always share a row. Move the pair together when resolving visual collisions, retaining separate clickable handles for very short ranges.
- Clicking an annotation opens its formatted note below the timeline without moving playback.
- Explicit playback actions allow listening from an annotation or looping its range.
- Dragging on the waveform makes a temporary time selection, like Audacity.
- Selecting alone does not create a note. An explicit Annotate selection action creates a range annotation.
- Double-clicking a range annotation handle selects that passage without moving the playhead, pausing/starting playback, or creating a new annotation.
- Point timestamps and range boundaries can be adjusted by dragging or editing timestamp fields, without a beat grid or musical snapping.
- Annotation labels use their timestamp and an excerpt from the first nonempty note text. Unwritten pending items show Pending annotation. There is no required title field.

## Capture and focus queue

- Pressing M outside text editors captures a point annotation at the current playback position.
- Capture does not pause playback or steal focus.
- Captured annotations enter a persistent focus queue in capture order, not timestamp order.
- Pausing after capture begins review: seek to the first queued marker and open its editor.
- Done → Next explicitly completes the current item, seeks to the next item, and opens its editor while remaining paused.
- Skip for now keeps the item pending and advances for the current review pass.
- During review, ordinary play/pause allows listening around the current item without switching annotations.
- Done → Next, Skip, or explicit queue selection changes the active item.
- Pending annotations and partially written notes survive closing the project.
- Reopening offers Continue writing with the pending count; it does not automatically seek or open an editor.
- Remember where listening paused before review. After the final item, offer to resume there, without automatically starting playback.
- Empty annotations may be explicitly completed; pending status is independent of whether note content is empty.
- Accidental captures can be deleted separately from completing an item.
- Skipped items are not automatically revisited in the same pass. At the end, show the pending count and offer Review pending or Resume listening.
- Provisionally for the first prototype, creating a range annotation during playback queues it without interruption; creating one while paused opens its editor immediately. Point and range annotations share the focus queue.
- Deleting an annotation is immediately undoable, without a routine confirmation dialog. Undo restores its content, timing, and pending status.
- Reaching the end of the recording starts review when annotations are pending; otherwise playback simply stops.
- Pressing M while paused captures the position and opens the new annotation immediately, without completing or discarding other pending annotations.

## Playback

- Initial controls: play/pause, restart, click-to-seek, zoom in/out, fit recording, loop selection or range annotation, current time, and total duration.
- Outside text editing, Space toggles play/pause and Left/Right seek backward/forward by five seconds. Seeking preserves playback state and stays within recording bounds. Preserve normal text navigation and native keyboard activation of focused controls.
- Outside editing/interactive controls, Z fits the current time selection to the timeline viewport without seeking or changing playback state. No selection is a safe no-op.
- During zoomed playback, horizontally follow the playhead as it crosses the visible area. Respect deliberate manual scrolling or selection zoom instead of immediately snapping away; avoid auto-follow while dragging, and resume following when appropriate without changing audio playback.
- Defer playback-speed changes, pitch changes, beat grids, and other listening aids until after the core prototype.
- Loop boundaries repeat playback without starting queue review. Outside an existing review session, explicit pause or the end of non-looping playback may begin review.

## Note editor

- Use Editor.js for direct editing without an Edit / Preview step.
- Save Editor.js block JSON as the canonical note content for both annotations and the project note.
- Initial formatting: paragraphs, headings, lists, bold, italic, and links.
- Markdown was a suggested editing approach, not a required storage format. Defer Markdown import/export.

## Saving

- Once a project has a location, autosave annotations, notes, timestamps, and queue progress.
- Also provide an explicit manual Save action.
- Save / Cmd+S persists the project without completing an annotation or advancing the queue. Only Done → Next completes the current queued item.
- Show Saving / Saved / Save failed status, retain edits on failure, and warn before closing with unsaved changes.
- Each new project is a self-contained folder with the original recording, its playback copy, and note data. Existing WAV-only projects remain readable and writable without mandatory conversion or renaming.
