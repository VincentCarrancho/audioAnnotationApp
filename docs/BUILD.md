# Prototype build handoff

## Authority and execution roles

Product source of truth: [PLAN.md](PLAN.md). Vocabulary: [../GLOSSARY.md](../GLOSSARY.md).
The user approved the prototype and requested this multi-agent build workflow.

- **Frontier orchestrator:** inspect the workspace, commission implementation, settle technical seams, review results against requirements, run verification, and maintain progress here. Delegate code changes, including small integration fixes.
- **Implementers:** multiple `general` subagents using `openrouter/openai/gpt-6.1-terra`, without a forced variant. Each receives a bounded task and explicit file ownership.
- The user will select Frontier for the main session. Do not claim that the session model has changed without confirmation from the runtime/user.
- Parallelize independent work after the shared contracts are established. Keep dependency changes, lockfile writes, and app composition under one assigned owner at a time.

Implementation proposals below may be refined by agents when platform/library facts require it. Preserve approved behavior; bring material product trade-offs back to the user.

## Current state

Phase 0 scaffolding and shared contracts are implemented. Frontend build and tests pass, and the foundation agent reports a successful macOS release build. Native WAV loading/decoding is confirmed; playback awaits a manual click because macOS denied automated assistive access. Phase 0 remains open until that playback check is confirmed. Project-folder permissions require later native verification. Git is initialized and `origin` points to the user-authorized public repository `VincentCarrancho/audioAnnotationApp`. Use explicit file ownership in this shared workspace and preserve existing user changes.

## Phase 0 — Foundation and contracts

Dispatch one Terra foundation agent before parallel implementation.

**Ownership:** initial root package/configuration files, `src-tauri/` scaffold, React entry point and shell, `src/contracts/`, and `docs/IMPLEMENTATION.md`.

Tasks:
1. Inspect available Node/package manager, Rust, and macOS build prerequisites. Report specific blockers; avoid unnecessary global installations.
2. Scaffold Tauri + React + TypeScript using Vite for the frontend development server and production build, with a minimal runnable shell, preserving these documents. Configure Tauri's development URL and frontend distribution path to match Vite. Use compatible current library versions and one package manager/lockfile.
3. Establish package scripts for development, frontend checks, tests, and desktop builds; document actual commands in the handoff.
4. Write shared types and interfaces before other agents consume them. Record their paths and semantics in `docs/IMPLEMENTATION.md`.
5. Smoke-test loading a local PCM WAV in the actual Tauri webview. Validate its file/asset permissions and WaveSurfer decoding before committing parallel work to an unproven playback path.

Contract topics:
- Stable project and annotation IDs; explicit point/range distinction; timestamps in seconds with valid finite bounds.
- One Editor.js document per annotation and one project note; timestamp labels and text excerpts are derived.
- Versioned project data with a recording path relative to the project folder, ordered annotations, persistent pending state, and capture ordering independent of timestamps.
- Persistent pending queue versus transient review-pass state (skipped items, current item, resume position). Persist enough to recover pending work without auto-opening review after restart.
- Explicit capture, pause, playback-end, select-note, done, skip, delete/undo, and resume events. Distinguish user pause from programmatic seek/load pauses and loop boundaries.
- Playback adapter, project create/open/load/save interface, and editor change/flush interface.
- Editing and saving revisions: asynchronous Editor.js serialization and disk writes must not overwrite newer content or lose the last keystrokes during note switching.

**Gate:** runnable scaffold, documented contracts, and demonstrated native local-WAV playback. If playback cannot be verified, report the exact limitation and resolve it before treating this phase as passed.

## Phase 1 — Parallel implementation

Frontier assigns these four independent workstreams using the completed contracts. Give agents the precise scaffold paths; the paths below describe intended ownership, not permission to overwrite another agent's work.

### A. Annotation and review state

**Ownership:** `src/domain/` and its tests.

- Implement pure state transitions for capture order, immediate paused capture, deferred focus, review entry, completion, skipping, deletion/undo, and returning to the saved resume position.
- Keep queue completion independent of whether content is empty.
- Preserve pending items across serialization/reopening; reopening offers review instead of automatically starting it.
- Support point/range timestamp edits and the provisional range-capture workflow.
- Provide state/actions to the UI; no WaveSurfer, editor DOM, or filesystem logic in this module.

**Gate:** behavioral tests cover capture after backward seeking; multiple M captures without playback interruption; pause-to-review; replay without focus changes; empty completion; skipped items ending a pass; deletion/undo restoring queue order; paused capture with existing pending work; persistent recovery; explicit resume position.

### B. Waveform, playback, and annotation handles

**Ownership:** `src/features/timeline/`, `src/audio/`, and their tests/styles.

- Implement WaveSurfer lifecycle, transport, seek, zoom/fit, duration/time display, drag selection, and selected-passage/range looping.
- Separate temporary selection from persisted annotations. Emitting Annotate selection must be intentional.
- Render click targets for points and ranges. Stack handles based on their screen-space footprints, recomputing on zoom, resize, and scrolling. Same-time handles remain individually reachable.
- Support drag edits and precise timestamp editing through agreed actions.
- Clicking a handle selects its note without seeking; explicit listening controls seek/play.
- Emit user-intent playback events without programmatic pauses or loop boundaries accidentally initiating review.

**Gate:** local audio plays; seeking, selection, loops, and zoom work; nearby handles unstack with room; exact overlaps stay accessible; cleanup avoids duplicate event listeners. Include a deterministic test of collision placement and verify the visual behavior in the running UI.

### C. Editor and annotation panels

**Ownership:** `src/features/notes/`, `src/features/queue/`, and their tests/styles.

- Integrate Editor.js with paragraphs, headings, lists, bold, italic, and links; direct editing without a preview toggle.
- Build the below-timeline note panel, general project note, queue controls/counts, pending labels, and timestamp/text excerpts.
- Provide Done → Next, Skip for now, Delete/Undo, review pending, explicit play/loop controls, and resume action through contracts.
- Flush content before changing annotation/project, completing, or saving. Guard against stale asynchronous editor callbacks attaching content to the wrong note.
- M shortcuts are handled by the app, outside text editing. Text entry and normal editor undo must remain usable.

**Gate:** two independently edited notes survive rapid switching and reload; formatted project notes persist; long notes remain readable; empty notes can complete; typing M in an editor never captures a marker.

### D. Desktop project persistence

**Ownership:** native implementation within `src-tauri/`, `src/persistence/`, and their tests. Foundation agent releases these paths before dispatch.

- Implement New project flow, native WAV/folder dialogs, recording copy, opening existing projects, and project-relative audio resolution.
- Use versioned metadata and robust writes (temporary file and replace, or equivalent) so an interrupted save does not truncate the previous project.
- Serialize writes; coalesce autosave work without losing newer revisions. Manual Save awaits the latest editor data and disk write without advancing the queue.
- Expose Saving / Saved / Save failed and retain dirty data after errors. Protect closing/switching with unsaved data, including asynchronous editor flushes.
- Validate project format and recording existence; surface actionable loading/copy/decoding errors without destroying files.
- Limit native capabilities to the required dialogs and project/audio access. Coordinate capability changes with the orchestrator.

**Gate:** create/copy/save/reopen round trip; a moved project folder opens with its audio; queue and both note types survive; failed writes preserve last saved data and report dirty state; older asynchronous saves cannot replace newer changes.

## Phase 2 — Integration

Dispatch a Terra integration agent after the four contracts and implementations are ready. Release or explicitly transfer ownership of files it must modify.

**Ownership:** app composition, root scripts/dependencies/lockfile, shared styles, integration tests, and agreed boundary changes.

- Wire domain state, waveform, Editor.js, and persistence into a single working desktop flow.
- Compose project controls, waveform/transport, annotation navigation, focus queue, note panel, and save status.
- Wire M outside editable controls, Cmd+S, and visible undo for deletion without conflicting with editor text undo.
- Ensure a single source of truth for annotation data; WaveSurfer regions and editor instances are views/adapters.
- Ensure ordinary note selection does not seek, captured annotations do not steal focus, and review playback does not re-enter review on pause.
- Handle end-of-recording separately from loop boundaries, programmatic stop, and load failures.
- Resolve contract mismatches by assigning patches to their owners or transferring ownership explicitly.

**Gate:** complete the acceptance scenario below in the actual macOS app. A browser-only demo is useful for UI iteration but does not verify native file handling or webview playback.

## Phase 3 — Verification and fixes

Frontier runs the actual package checks and desktop build commands established by the scaffold. Dispatch a Terra verification agent to inspect the full app against PLAN.md and report concrete gaps; dispatch Terra fix agents for implementation changes.

Use meaningful state-machine, persistence, and integration tests for the risk areas above. Avoid snapshot-only or implementation-mirroring tests. Repeat checks affected by fixes; report environmental blockers explicitly rather than marking unrun checks passed.

### End-to-end acceptance scenario

1. Create a project from a WAV, then move the original WAV outside its original location. The project copy still plays.
2. Capture three M markers during playback. Sound continues and editor focus stays unchanged.
3. Pause. Review opens the first capture at its timestamp. Write formatted text, replay around it, and pause without changing notes.
4. Complete one item, skip one, and complete another empty. The pass ends with one pending item and offers return to the original listening position.
5. Select a range without creating a note, loop it, then annotate it. Verify running versus paused creation behavior.
6. Create same-time and nearby annotations. Each handle is clickable; zoom releases collisions when space permits. Adjust a point and range boundaries precisely.
7. Edit two notes quickly and the project note. Cmd+S saves without completing an item. Delete and undo an annotation with its content and queue status intact.
8. Close and reopen the project. Notes, timing, and pending status survive; review does not auto-open. Move the whole project folder and verify reopening.
9. Reach the non-looping recording end with pending captures and verify review starts. Repeat a loop and verify review does not start at its boundaries.
10. Exercise a save failure in a disposable test project; verify visible failure, retained dirty edits, and protection against silent loss on close/switch.

### Completion report

Report the runnable app location, exact launch/build commands, tests and native checks actually completed, unresolved limitations, and feedback targets for the provisional range-queue behavior. Update this plan's status and implementation notes to reflect reality.

## Dispatch template

Include these fields in every Terra agent task:

```text
Goal: [bounded deliverable and phase]
Model: openrouter/openai/gpt-6.1-terra
Read: AGENTS.md, docs/PLAN.md, GLOSSARY.md, docs/BUILD.md,
      and docs/IMPLEMENTATION.md when it exists
Writable paths: [exclusive ownership]
Dependencies: [finished interfaces and preceding handoffs]
Acceptance: [specific observable checks]
Coordination: request out-of-scope changes from orchestrator; preserve peers' work
Return: changed files, checks/results, blockers, integration instructions
```

## Progress

- [x] Product behavior approved.
- [x] Multi-agent build plan prepared; Terra model ID verified.
- [x] Frontier orchestration session selected by user.
- [ ] Phase 0: foundation/contracts and native playback smoke test.
- [ ] Phase 1: four implementation workstreams complete.
- [ ] Phase 2: integrated native app.
- [ ] Phase 3: verification, fixes, and final handoff.
