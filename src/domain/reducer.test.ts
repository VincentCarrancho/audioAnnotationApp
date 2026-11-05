import { describe, expect, it } from 'vitest'
import type { DomainAction, ProjectData } from '../contracts'
import { createInitialDomainState, domainReducer } from './index'

function project(): ProjectData {
  return { version: 1, id: 'project', name: 'Recording', recording: { relativePath: 'recording.wav' }, annotations: [], projectNote: { blocks: [] }, pendingAnnotationIds: [] }
}

function session(initial = createInitialDomainState(project())) {
  let state = initial
  return {
    get state() { return state },
    send(action: DomainAction) {
      const transition = domainReducer(state, action)
      state = transition.state
      return transition.effects
    },
  }
}

describe('capture and review', () => {
  it('keeps backward-seek captures in capture order without interrupting playback or focus', () => {
    const s = session()
    s.send({ type: 'select-project-note' })
    expect(s.send({ type: 'capture-point', id: 'first', time: 80, duration: 100, playing: true })).toEqual([])
    expect(s.send({ type: 'capture-point', id: 'second', time: 10, duration: 100, playing: true })).toEqual([])
    expect(s.send({ type: 'annotate-selection', id: 'third', start: 5, end: 8, position: 10, duration: 100, playing: true })).toEqual([])
    expect(s.state.selectedNote).toEqual({ kind: 'project' })
    expect(s.state.project.pendingAnnotationIds).toEqual(['first', 'second', 'third'])
    expect(s.send({ type: 'user-paused', position: 42 })).toEqual([{ type: 'seek', time: 80 }, { type: 'open-note', id: 'first' }])
    expect(s.state.review).toEqual({ status: 'active', currentId: 'first', skippedIds: [], resumePosition: 42 })
    expect(s.send({ type: 'user-paused', position: 81 })).toEqual([])
    expect(s.send({ type: 'playback-ended', position: 100 })).toEqual([])
    expect(s.state.selectedNote).toEqual({ kind: 'annotation', id: 'first' })
  })

  it('completes empty notes, skips only this pass, offers a result, and resumes without autoplay', () => {
    const s = session()
    for (const [id, time] of [['a', 70], ['b', 5], ['c', 15]] as const) s.send({ type: 'capture-point', id, time, duration: 100, playing: true })
    s.send({ type: 'user-paused', position: 90 })
    expect(s.send({ type: 'done-next' })).toEqual([{ type: 'seek', time: 5 }, { type: 'open-note', id: 'b' }])
    expect(s.send({ type: 'skip' })).toEqual([{ type: 'seek', time: 15 }, { type: 'open-note', id: 'c' }])
    expect(s.send({ type: 'done-next' })).toEqual([{ type: 'offer-review-result', pendingCount: 1, resumePosition: 90 }])
    expect(s.state.project.pendingAnnotationIds).toEqual(['b'])
    expect(s.send({ type: 'review-pending', position: 15 })).toEqual([{ type: 'seek', time: 5 }, { type: 'open-note', id: 'b' }])
    expect(s.send({ type: 'done-next' })).toEqual([{ type: 'offer-review-result', pendingCount: 0, resumePosition: 90 }])
    expect(s.send({ type: 'resume-listening' })).toEqual([{ type: 'seek', time: 90 }])
    expect(s.state.review).toEqual({ status: 'inactive' })
  })

  it('starts on non-looping playback end and does nothing on pause or end with no pending', () => {
    const s = session()
    expect(s.send({ type: 'playback-ended', position: 100 })).toEqual([])
    expect(s.send({ type: 'user-paused', position: 30 })).toEqual([])
    s.send({ type: 'capture-point', id: 'end', time: 70, duration: 100, playing: true })
    expect(s.send({ type: 'playback-ended', position: 100 })).toEqual([{ type: 'seek', time: 70 }, { type: 'open-note', id: 'end' }])
    expect(s.state.review).toMatchObject({ status: 'active', resumePosition: 100 })
  })

  it('opens paused captures immediately while retaining previously pending items', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'older', time: 20, duration: 100, playing: true })
    expect(s.send({ type: 'capture-point', id: 'new', time: 30, duration: 100, playing: false })).toEqual([{ type: 'open-note', id: 'new' }])
    expect(s.state.project.pendingAnnotationIds).toEqual(['older', 'new'])
    expect(s.state.review).toMatchObject({ status: 'active', currentId: 'new', resumePosition: 30 })
    expect(s.send({ type: 'done-next' })).toEqual([{ type: 'seek', time: 20 }, { type: 'open-note', id: 'older' }])
    expect(s.state.project.pendingAnnotationIds).toEqual(['older'])
  })

  it('opens paused range creation without seeking and preserves an active pass resume position', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'a', time: 10, duration: 100, playing: true })
    s.send({ type: 'user-paused', position: 60 })
    expect(s.send({ type: 'annotate-selection', id: 'range', start: 5, end: 9, position: 80, duration: 100, playing: false })).toEqual([{ type: 'open-note', id: 'range' }])
    expect(s.state.review).toMatchObject({ status: 'active', currentId: 'range', resumePosition: 60 })
    expect(s.state.project.pendingAnnotationIds).toEqual(['a', 'range'])
    expect(s.send({ type: 'done-next' })).toEqual([{ type: 'seek', time: 10 }, { type: 'open-note', id: 'a' }])
  })

  it('uses the actual paused playhead, not range start, as the new pass resume position', () => {
    const s = session()
    expect(s.send({ type: 'annotate-selection', id: 'range', start: 5, end: 9, position: 70, duration: 100, playing: false })).toEqual([{ type: 'open-note', id: 'range' }])
    expect(s.state.review).toMatchObject({ status: 'active', currentId: 'range', resumePosition: 70 })
    s.send({ type: 'done-next' })
    expect(s.send({ type: 'resume-listening' })).toEqual([{ type: 'seek', time: 70 }])
  })

  it('retains a finished pass resume position when a paused range immediately opens', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'a', time: 10, duration: 100, playing: true })
    s.send({ type: 'user-paused', position: 45 })
    s.send({ type: 'done-next' })
    s.send({ type: 'annotate-selection', id: 'range', start: 5, end: 9, position: 70, duration: 100, playing: false })
    expect(s.state.review).toMatchObject({ status: 'active', currentId: 'range', resumePosition: 45 })
  })

  it('does not auto-cycle skipped items, but a new capture enables the next listening pass', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'skipped', time: 5, duration: 100, playing: true })
    s.send({ type: 'user-paused', position: 40 })
    s.send({ type: 'skip' })
    expect(s.send({ type: 'user-paused', position: 60 })).toEqual([])
    expect(s.state.review).toMatchObject({ status: 'finished', resumePosition: 40 })
    expect(s.send({ type: 'resume-listening' })).toEqual([{ type: 'seek', time: 40 }])
    expect(s.send({ type: 'user-paused', position: 60 })).toEqual([])
    expect(s.send({ type: 'playback-ended', position: 100 })).toEqual([])
    expect(s.send({ type: 'capture-point', id: 'new', time: 70, duration: 100, playing: true })).toEqual([])
    expect(s.send({ type: 'user-paused', position: 80 })).toEqual([{ type: 'seek', time: 5 }, { type: 'open-note', id: 'skipped' }])
    expect(s.state.review).toMatchObject({ status: 'active', resumePosition: 80 })
    expect(s.send({ type: 'done-next' })).toEqual([{ type: 'seek', time: 70 }, { type: 'open-note', id: 'new' }])
  })

  it('starts a new pass after a playing capture while the previous result is still displayed', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'first', time: 5, duration: 100, playing: true })
    s.send({ type: 'user-paused', position: 40 })
    s.send({ type: 'done-next' })
    expect(s.send({ type: 'annotate-selection', id: 'new', start: 10, end: 20, position: 60, duration: 100, playing: true })).toEqual([])
    expect(s.state.review).toEqual({ status: 'inactive' })
    expect(s.send({ type: 'playback-ended', position: 100 })).toEqual([{ type: 'seek', time: 10 }, { type: 'open-note', id: 'new' }])
    expect(s.state.review).toMatchObject({ resumePosition: 100 })
  })

  it('explicitly reviews skipped items even after resuming without a new capture', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'skipped', time: 5, duration: 100, playing: true })
    s.send({ type: 'user-paused', position: 40 })
    s.send({ type: 'skip' })
    s.send({ type: 'resume-listening' })
    expect(s.send({ type: 'review-pending', position: 60 })).toEqual([{ type: 'seek', time: 5 }, { type: 'open-note', id: 'skipped' }])
    expect(s.state.review).toMatchObject({ resumePosition: 60 })
  })

  it('never completes or skips a different current item when viewing another note', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'a', time: 1, duration: 100, playing: true })
    s.send({ type: 'capture-point', id: 'b', time: 2, duration: 100, playing: true })
    s.send({ type: 'user-paused', position: 50 })
    expect(s.send({ type: 'select-note', id: 'b' })).toEqual([{ type: 'open-note', id: 'b' }])
    expect(s.send({ type: 'done-next' })).toEqual([])
    expect(s.send({ type: 'skip' })).toEqual([])
    expect(s.state.project.pendingAnnotationIds).toEqual(['a', 'b'])
    expect(s.state.review).toMatchObject({ currentId: 'a' })
    s.send({ type: 'select-project-note' })
    s.send({ type: 'done-next' })
    expect(s.state.project.pendingAnnotationIds).toEqual(['a', 'b'])
    expect(s.send({ type: 'select-queue-item', id: 'b', position: 30 })).toEqual([{ type: 'seek', time: 2 }, { type: 'open-note', id: 'b' }])
    expect(s.state.review).toMatchObject({ resumePosition: 50 })
    expect(s.send({ type: 'done-next' })).toEqual([{ type: 'seek', time: 1 }, { type: 'open-note', id: 'a' }])
    expect(s.state.project.pendingAnnotationIds).toEqual(['a'])
  })

  it('allows explicit selection of a skipped pending item without automatically revisiting skips', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'a', time: 1, duration: 100, playing: true })
    s.send({ type: 'capture-point', id: 'b', time: 2, duration: 100, playing: true })
    s.send({ type: 'user-paused', position: 20 })
    s.send({ type: 'skip' })
    s.send({ type: 'select-queue-item', id: 'a', position: 2 })
    expect(s.state.review).toMatchObject({ currentId: 'a', skippedIds: [] })
    expect(s.send({ type: 'done-next' })).toEqual([{ type: 'seek', time: 2 }, { type: 'open-note', id: 'b' }])
  })
})

describe('persistence, edits, and deletion', () => {
  it('selects a pending item directly on reopen and retains the supplied playhead', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'a', time: 10, duration: 100, playing: true })
    s.send({ type: 'capture-point', id: 'b', time: 20, duration: 100, playing: true })
    const reopened = session(createInitialDomainState(JSON.parse(JSON.stringify(s.state.project)) as ProjectData))
    expect(reopened.send({ type: 'select-queue-item', id: 'b', position: 75 })).toEqual([{ type: 'seek', time: 20 }, { type: 'open-note', id: 'b' }])
    expect(reopened.state.review).toMatchObject({ status: 'active', currentId: 'b', resumePosition: 75 })
    reopened.send({ type: 'done-next' })
    reopened.send({ type: 'done-next' })
    expect(reopened.send({ type: 'resume-listening' })).toEqual([{ type: 'seek', time: 75 }])
  })

  it('preserves the finished pass resume position when selecting a pending item', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'a', time: 10, duration: 100, playing: true })
    s.send({ type: 'user-paused', position: 75 })
    s.send({ type: 'skip' })
    const finished = s.state
    expect(s.send({ type: 'review-pending', position: NaN })).toEqual([])
    expect(s.state).toBe(finished)
    s.send({ type: 'select-queue-item', id: 'a', position: 10 })
    expect(s.state.review).toMatchObject({ status: 'active', resumePosition: 75 })
  })

  it('reopens persisted work without auto-selection and starts only on explicit review', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'a', time: 10, duration: 100, playing: true })
    s.send({ type: 'update-note', target: { kind: 'annotation', id: 'a' }, note: { blocks: [{ type: 'paragraph', data: { text: 'draft' } }] } })
    s.send({ type: 'user-paused', position: 20 })
    const reopened = session(createInitialDomainState(JSON.parse(JSON.stringify(s.state.project)) as ProjectData))
    expect(reopened.state.review).toEqual({ status: 'inactive' })
    expect(reopened.state.selectedNote).toBeNull()
    expect(reopened.state.undoDelete).toBeNull()
    expect(reopened.state.project.annotations[0].note.blocks[0].data.text).toBe('draft')
    expect(reopened.send({ type: 'review-pending', position: 45 })).toEqual([{ type: 'seek', time: 10 }, { type: 'open-note', id: 'a' }])
    reopened.send({ type: 'done-next' })
    expect(reopened.send({ type: 'resume-listening' })).toEqual([{ type: 'seek', time: 45 }])
  })

  it('deletes the current annotation without completing another and restores content, time and queue order', () => {
    const s = session()
    for (const [id, time] of [['a', 10], ['b', 20], ['c', 30]] as const) s.send({ type: 'capture-point', id, time, duration: 100, playing: true })
    const note = { blocks: [{ type: 'paragraph', data: { text: 'important' } }] }
    s.send({ type: 'update-note', target: { kind: 'annotation', id: 'a' }, note })
    s.send({ type: 'user-paused', position: 80 })
    expect(s.send({ type: 'delete-annotation', id: 'a' })).toEqual([{ type: 'seek', time: 20 }, { type: 'open-note', id: 'b' }])
    expect(s.state.project.pendingAnnotationIds).toEqual(['b', 'c'])
    expect(s.state.review).toMatchObject({ currentId: 'b' })
    s.send({ type: 'undo-delete' })
    expect(s.state.project.pendingAnnotationIds).toEqual(['a', 'b', 'c'])
    expect(s.state.project.annotations.map((a) => a.id)).toEqual(['a', 'b', 'c'])
    expect(s.state.project.annotations[0]).toEqual({ id: 'a', anchor: { kind: 'point', time: 10 }, note })
    expect(s.state.review).toMatchObject({ currentId: 'b' })
    expect(s.send({ type: 'done-next' })).toEqual([{ type: 'seek', time: 10 }, { type: 'open-note', id: 'a' }])
  })

  it('restores a completed annotation as completed and updates a finished result after undo', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'a', time: 1, duration: 100, playing: true })
    s.send({ type: 'user-paused', position: 9 })
    s.send({ type: 'done-next' })
    s.send({ type: 'delete-annotation', id: 'a' })
    expect(s.send({ type: 'undo-delete' })).toEqual([{ type: 'offer-review-result', pendingCount: 0, resumePosition: 9 }])
    expect(s.state.project.annotations.map((a) => a.id)).toEqual(['a'])
    expect(s.state.project.pendingAnnotationIds).toEqual([])
    const t = session()
    t.send({ type: 'capture-point', id: 'b', time: 2, duration: 100, playing: true })
    t.send({ type: 'user-paused', position: 9 })
    expect(t.send({ type: 'delete-annotation', id: 'b' })).toEqual([{ type: 'offer-review-result', pendingCount: 0, resumePosition: 9 }])
    expect(t.send({ type: 'undo-delete' })).toEqual([{ type: 'offer-review-result', pendingCount: 1, resumePosition: 9 }])
  })

  it('keeps an undone skipped annotation excluded until a new pass', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'a', time: 1, duration: 100, playing: true })
    s.send({ type: 'capture-point', id: 'b', time: 2, duration: 100, playing: true })
    s.send({ type: 'user-paused', position: 9 })
    s.send({ type: 'skip' })
    s.send({ type: 'delete-annotation', id: 'a' })
    s.send({ type: 'undo-delete' })
    expect(s.send({ type: 'done-next' })).toEqual([{ type: 'offer-review-result', pendingCount: 1, resumePosition: 9 }])
    expect(s.send({ type: 'review-pending', position: 2 })).toEqual([{ type: 'seek', time: 1 }, { type: 'open-note', id: 'a' }])
  })

  it('undoes a middle deletion at its original annotation and pending indexes', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'a', time: 50, duration: 100, playing: true })
    s.send({ type: 'annotate-selection', id: 'b', start: 4, end: 6, position: 5, duration: 100, playing: true })
    s.send({ type: 'capture-point', id: 'c', time: 5, duration: 100, playing: true })
    s.send({ type: 'delete-annotation', id: 'b' })
    expect(s.state.project.annotations.map((item) => item.id)).toEqual(['a', 'c'])
    expect(s.state.project.pendingAnnotationIds).toEqual(['a', 'c'])
    s.send({ type: 'undo-delete' })
    expect(s.state.project.annotations.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(s.state.project.pendingAnnotationIds).toEqual(['a', 'b', 'c'])
    expect(s.state.project.annotations[1].anchor).toEqual({ kind: 'range', start: 4, end: 6 })
  })

  it('targets edits by ID rather than selected editor and validates anchor bounds', () => {
    const s = session()
    s.send({ type: 'capture-point', id: 'a', time: 1, duration: 100, playing: true })
    s.send({ type: 'capture-point', id: 'b', time: 2, duration: 100, playing: true })
    s.send({ type: 'select-note', id: 'b' })
    const note = { blocks: [{ type: 'paragraph', data: { text: 'late snapshot' } }] }
    s.send({ type: 'update-note', target: { kind: 'annotation', id: 'a' }, note })
    s.send({ type: 'update-note', target: { kind: 'project' }, note })
    expect(s.state.project.annotations[0].note).toEqual(note)
    expect(s.state.project.annotations[1].note).toEqual({ blocks: [] })
    expect(s.state.project.projectNote).toEqual(note)
    for (const anchor of [{ kind: 'point', time: NaN }, { kind: 'point', time: 101 }, { kind: 'range', start: 8, end: 8 }, { kind: 'range', start: -1, end: 8 }] as const) {
      const before = s.state
      s.send({ type: 'update-anchor', id: 'a', anchor, duration: 100 })
      expect(s.state).toBe(before)
    }
    s.send({ type: 'update-anchor', id: 'a', anchor: { kind: 'range', start: 8, end: 100 }, duration: 100 })
    expect(s.state.project.annotations[0].anchor).toEqual({ kind: 'range', start: 8, end: 100 })
  })

  it('rejects invalid captures, duplicate IDs and missing IDs without changing state', () => {
    const s = session()
    const invalid: DomainAction[] = [
      { type: 'capture-point', id: 'bad', time: -1, duration: 100, playing: true },
      { type: 'capture-point', id: 'bad', time: Infinity, duration: 100, playing: true },
      { type: 'annotate-selection', id: 'bad', start: 2, end: 1, position: 1, duration: 100, playing: true },
      { type: 'capture-point', id: 'bad', time: 101, duration: 100, playing: true },
      { type: 'capture-point', id: 'bad', time: 0, duration: Infinity, playing: false },
      { type: 'capture-point', id: 'bad', time: 0, duration: -1, playing: true },
      { type: 'annotate-selection', id: 'bad', start: 0, end: 101, position: 5, duration: 100, playing: true },
      { type: 'annotate-selection', id: 'bad', start: 0, end: 5, position: 101, duration: 100, playing: false },
      { type: 'annotate-selection', id: 'bad', start: 0, end: 5, position: NaN, duration: 100, playing: true },
      { type: 'select-note', id: 'missing' }, { type: 'select-queue-item', id: 'missing', position: 1 },
      { type: 'delete-annotation', id: 'missing' }, { type: 'undo-delete' },
      { type: 'update-anchor', id: 'missing', anchor: { kind: 'point', time: 0 }, duration: 100 },
      { type: 'update-note', target: { kind: 'annotation', id: 'missing' }, note: { blocks: [] } },
      { type: 'resume-listening' }, { type: 'review-pending', position: NaN },
    ]
    for (const action of invalid) {
      const before = s.state
      expect(s.send(action)).toEqual([])
      expect(s.state).toBe(before)
    }
    s.send({ type: 'capture-point', id: 'a', time: 1, duration: 100, playing: true })
    const before = s.state
    s.send({ type: 'capture-point', id: 'a', time: 3, duration: 100, playing: false })
    expect(s.state).toBe(before)
    for (const position of [-1, NaN, Infinity]) {
      expect(s.send({ type: 'select-queue-item', id: 'a', position })).toEqual([])
      expect(s.state).toBe(before)
    }
  })

  it('does not mutate previous project snapshots', () => {
    const original = createInitialDomainState(project())
    const first = domainReducer(original, { type: 'capture-point', id: 'a', time: 1, duration: 100, playing: true }).state
    const second = domainReducer(first, { type: 'update-anchor', id: 'a', anchor: { kind: 'point', time: 3 }, duration: 10 }).state
    expect(original.project.annotations).toEqual([])
    expect(first.project.annotations[0].anchor).toEqual({ kind: 'point', time: 1 })
    expect(second.project.annotations[0].anchor).toEqual({ kind: 'point', time: 3 })
  })
})
