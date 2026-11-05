# Domain integration handoff

`src/domain/index.ts` exports `createInitialDomainState(project)` and `domainReducer(state, action)`. Both are pure and use the shared types in `src/contracts`. Initialization must be called on every project open; serialize `state.project`, not transient review, selection, or undo state. Initialization does not seek or select anything. Show a Continue writing affordance when `project.pendingAnnotationIds.length > 0`.

```ts
import { createInitialDomainState, domainReducer } from './domain'
import type { DomainAction, DomainState } from './contracts'

let state: DomainState = createInitialDomainState(openedProject)
function dispatch(action: DomainAction) {
  const transition = domainReducer(state, action)
  state = transition.state
  // Render state and persist changed state.project using the integration save queue.
  for (const effect of transition.effects) {
    switch (effect.type) {
      case 'seek': playback.seek(effect.time); break
      case 'open-note': /* open annotation editor for effect.id */ break
      case 'open-project-note': /* open project editor */ break
      case 'offer-review-result': /* show pendingCount and resumePosition */ break
    }
  }
}
```

This is illustrative, not a complete async dispatcher. **Flush the outgoing editor before any action that can change selection or remove its annotation**, and process/serialize dispatches and effects so a later editor open cannot race an earlier one. Retain the editor snapshot's original target and revision; validate revision freshness in composition before dispatching `update-note`. Manual save flushes and persists without dispatching `done-next`. The selected note in state is authoritative, including when deletion clears it without an `open-note` effect.

- Caller supplies fresh opaque IDs. Capture actions use transport `playing`, not editor focus; send `user-paused` only for explicit user pauses and `playback-ended` only for non-looping recording end. Never map programmatic pauses or loop boundaries to these actions.
- Playing captures append an empty annotation and pending ID without transport or focus effects. A playing capture after a finished pass makes the next user pause/end start a fresh pass. Paused captures open the new note without a seek and start or continue review. For a range, selecting the waveform alone does not dispatch an annotation action.
- `select-note` and `select-project-note` do not change the active review item or seek. Enable Done/Skip only when `review.status === 'active'` and `selectedNote` is that current annotation; the reducer also guards this invariant. Use `select-queue-item` to switch review items or directly start a pass at the chosen pending item after reopening.
- `review-pending` after a finished pass preserves the original resume position; it clears pass skips. Explicitly selecting a skipped pending item also makes it eligible again. Deleting the current item advances to another eligible item or offers the result, never completes another item. Undo restores one most recently deleted annotation and its original pending status/order; it does not switch the current editor. Skipped IDs may remain in transient review state while their annotations are deleted, so undo preserves skip status for that pass.
- `resume-listening` acts only after a finished pass, emits one seek and never a play instruction. When items were skipped, resuming defers review on ordinary user pauses until a new capture, so pausing again does not cycle through skipped-only work. Reaching the non-looping recording end still starts review when pending items exist and no pass is active. The user can always explicitly choose Review pending or select a queue item. A new capture clears that deferral and the next pass includes all pending items in capture order. `offer-review-result` may reappear with a refreshed pending count after delete/undo while finished.
- `update-anchor` validates the supplied known duration. Missing IDs, duplicate capture IDs, malformed anchors/positions and inappropriate actions are safe no-ops. The deleted ID remains reserved while its undo snapshot exists. Inputs are treated as immutable: don't mutate project, note documents, or action objects after dispatch.

## Action shapes and position validation

```ts
{ type: 'capture-point', id, time, duration, playing }
{ type: 'annotate-selection', id, start, end, position, duration, playing }
{ type: 'select-queue-item', id, position }
```

Provide the actual known finite recording duration and current playhead in seconds. The reducer validates point/range anchors and the range action's playhead against that duration. A paused point starts a pass with `time` as resume position; a paused range uses `position`. Existing active/finished passes preserve their resume position. Queue selection starts an inactive pass at the chosen item with the supplied `position`; active/finished passes keep their prior resume position.

Queue selection, `review-pending`, `user-paused`, and `playback-ended` do not carry duration, so the reducer can reject nonfinite or negative positions but cannot check their upper bound. Composition must ensure these positions are within the known recording duration before dispatch. A future shared seam would add `duration: Seconds` to those actions (or make known duration part of domain state) if reducer-level upper-bound validation is required.
