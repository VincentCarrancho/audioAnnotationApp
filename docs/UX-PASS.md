# First UI/UX pass

User feedback while testing aNotate: add transport shortcuts, keep range pairs on one row, and double-click a range to select it without playback interruption. Approved behavior is in PLAN.md; implement these before the next installed build.

## Ownership

- **Transport agent:** `src/App.tsx`, `src/app/**`, `src/style.css` if needed, and README.md keyboard documentation. Implement Space play/pause and Left/Right five-second seeking using existing timeline commands and actual current position. Ordinary user pause still starts queue review; scrubbing does not. Preserve text editing, modifier shortcuts, and native keyboard activation of focused controls.
- **Timeline agent:** `src/features/timeline/**` and `src/audio/**` only. Place each range's two handles as a unit in one row, resolve collisions using screen space, and unstack when zoom provides room. Exact overlaps and very short ranges must stay individually reachable. Double-click either range handle selects the existing range without seeking, changing play/pause, or creating a note.
- Existing shared contracts and persistence/native import are unchanged unless a concrete seam requires orchestrator-approved ownership transfer.

## Regression gates

- Actual app key events: Space on non-editing workspace toggles once, ignores unwanted repeats, and pauses through the user-intent path. No audio loaded means safe no-op.
- Left/Right use live position, step five seconds, clamp at start/end, preserve playing/paused state, and do not enter review.
- Typing, caret navigation, range-input behavior, Editor.js controls, and native Space activation on focused buttons are not hijacked. Existing M, Cmd+S, and deletion undo remain intact.
- Range start/end share a row at collision boundaries, exact duplicates, narrow ranges, and viewport edges. Other point/range handles remain reachable. Zoom and resize release visual collisions without permanent musical layers.
- Double-click selection updates the highlighted passage and selection actions only; single click still opens notes without seeking, and drag timing stays offset-correct.
- Focused tests go red before fixes, then pass. Run the complete frontend suite/typecheck and rebuild the native app after both owners release. Verify live DOM/layout where tooling permits.

## Install sequencing

The user requested removing the old installed `/Applications/wavNotes.app` after the replacement is ready. The user also authorized updating `/Applications/aNotate.app` after saving/quitting. They resumed testing it to provide these notes, so recheck that it has quit before installation; never force-close it or overwrite saved projects. Preserve recoverable old app bundles when replacing/removing them.

## Progress

- [x] Transport shortcuts.
- [x] Paired range layout and double-click selection.
- [ ] Combined checks and package build.
- [ ] Installed update and old wavNotes app moved to Trash.

### Verification handoff

- Orchestrator ran all 112 frontend tests and TypeScript checks successfully. The latest native source passed all 23 Rust tests with the format matrix enabled; the newly packaged decoder also passed the explicit ten-fixture gate.
- Live browser DOM inspection confirmed each overlapping range pair shares its row. Browser interaction was concurrent with user testing, so do not claim an isolated live transport/double-click pass; those behaviors have focused component/controller tests and await native user feedback.
- Desktop build succeeded, but the final `codesign --verify --deep --strict` check failed with `code has no resources but signature indicates they must be present`. Native owner is correcting reproducible ad-hoc package signing before installation. User has quit aNotate; recheck before modifying its installed copy.
