# Timeline integration handoff

Import `Timeline`, `TimelineHandle`, and `TimelineProps` from `src/features/timeline`. Import `WaveSurferPlaybackAdapter` from `src/audio` when a standalone `PlaybackAdapter` is needed. `PlaybackEvent` in `src/contracts/playback.ts` includes the non-review-triggering `{ type: 'paused'; position: Seconds }` event.

```tsx
const timeline = useRef<TimelineHandle>(null)

<Timeline
  ref={timeline}
  recordingUrl={session.recordingUrl}
  annotations={state.project.annotations}
  selectedAnnotationId={state.selectedNote?.kind === 'annotation' ? state.selectedNote.id : null}
  onEvent={(event) => {
    // Map annotation-selected to select-note (no seek), user-paused to
    // user-paused, and ended to playback-ended. Track transport state using
    // playing and paused. paused, loop-boundary, and selection-changed must
    // NOT start review.
  }}
  onAnnotateSelection={({ start, end }) => {
    // Dispatch annotate-selection with a fresh ID, start/end, current playing
    // state, current playhead position, and duration from the ready event.
  }}
  onAnchorChange={(id, anchor, duration) => {
    // Dispatch update-anchor with id, anchor and duration.
  }}
/>
```

Composition can call `timeline.current?.getPosition()` for M capture; `seek(time)` for reducer seek effects; `playFrom(time)` for an explicit annotation listening action; `loopRange({ start, end })` for explicit range listening; `clearLoop()`; `play()`; or `pause('user' | 'programmatic')`. `playFrom` clears an active loop, seeks and plays; `loopRange` enables a valid range, seeks to its start and plays. Both explicit and programmatic pauses emit `paused` when playback stops; only an explicit user pause also emits `user-paused`. A seek to the end emits `paused` when playback stops, not `ended`; a natural non-looping finish emits `paused` and `ended`. Transient loop-boundary pauses do not mark transport paused, and a restarted loop emits `playing`. `play`/`playFrom`/`loopRange` return promises; callers should handle rejection. The component catches errors from its own transport buttons and reports audio errors through `onEvent` and its visible error message. `selection-changed` is transient; only the explicit callback creates a range annotation. Controlled annotations are never mutated by the timeline.

Use the URL supplied by the repository, not a filesystem path. A URL change destroys the old WaveSurfer and mounts a new player, clearing selection, loop and zoom. Subscribe only through `onEvent`; the component owns the subscription and cleanup. Callbacks are always read from the latest props. Controls and timestamps are scoped with `wn-` classes. The waveform uses one outer horizontal scroll area; its fit-to-container WaveSurfer rendering expands on zoom. Handles pack by pixel footprint and remain separate at exact overlaps; the selected annotation's numeric seconds fields commit on blur/Enter. Invalid or inverted edits are not emitted.

Range endpoints pack together on one row, while the intervening passage does not reserve space. Closely spaced endpoints move apart within the content bounds and a fine connector indicates their true timestamp. Double-clicking either endpoint publishes the existing `selection-changed` event and highlights that passage; it does not seek, change playback, or call `onAnnotateSelection`. A single pointer click still publishes `annotation-selected`; a drag remains a timing edit, including when the content scrolls during capture.

Native project-file permissions and actual project playback remain the persistence/integration owners' responsibility. The reported native restart `operation not supported` has no established root cause; a browser or mocked test is not native verification. Visual testing in a running UI and a native playback/restart check remain outstanding.
