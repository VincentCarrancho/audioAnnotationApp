import { isValidAnchor } from '../contracts/project'
import type { Annotation, AnnotationAnchor, AnnotationId, ProjectData, Seconds } from '../contracts/project'
import type { DomainEffect, DomainReducer, DomainState, DomainTransition, ReviewPass } from '../contracts/domain'

/** Opening a project never restores a review pass, selection, or deletion undo. */
export function createInitialDomainState(project: ProjectData): DomainState {
  return { project, review: { status: 'inactive' }, selectedNote: null, undoDelete: null }
}

const unchanged = (state: DomainState): DomainTransition => ({ state, effects: [] })
const validPosition = (position: Seconds) => Number.isFinite(position) && position >= 0
const anchorTime = (annotation: Annotation) => annotation.anchor.kind === 'point' ? annotation.anchor.time : annotation.anchor.start

function openReviewItem(state: DomainState, id: AnnotationId, review: Extract<ReviewPass, { status: 'active' }>): DomainTransition {
  const annotation = state.project.annotations.find((item) => item.id === id)
  if (!annotation) return unchanged(state)
  return {
    state: { ...state, review, selectedNote: { kind: 'annotation', id } },
    effects: [{ type: 'seek', time: anchorTime(annotation) }, { type: 'open-note', id }],
  }
}

function startReview(state: DomainState, position: Seconds): DomainTransition {
  if (!validPosition(position)) return unchanged(state)
  const id = state.project.pendingAnnotationIds.find((pendingId) => state.project.annotations.some((item) => item.id === pendingId))
  if (!id) return unchanged(state)
  return openReviewItem(state, id, { status: 'active', currentId: id, skippedIds: [], resumePosition: position })
}

function advanceReview(state: DomainState, review: Extract<ReviewPass, { status: 'active' }>): DomainTransition {
  const next = state.project.pendingAnnotationIds.find((id) => !review.skippedIds.includes(id) && state.project.annotations.some((item) => item.id === id))
  if (next) return openReviewItem(state, next, { ...review, currentId: next })
  const effect: DomainEffect = { type: 'offer-review-result', pendingCount: state.project.pendingAnnotationIds.length, resumePosition: review.resumePosition }
  return { state: { ...state, review: { status: 'finished', resumePosition: review.resumePosition } }, effects: [effect] }
}

function capture(state: DomainState, id: AnnotationId, anchor: AnnotationAnchor, position: Seconds, duration: Seconds, playing: boolean): DomainTransition {
  if (!id || !isValidAnchor(anchor, duration) || !isValidAnchor({ kind: 'point', time: position }, duration) || state.project.annotations.some((item) => item.id === id) || state.undoDelete?.annotation.id === id) return unchanged(state)
  const annotation: Annotation = { id, anchor: { ...anchor }, note: { blocks: [] } }
  const project = {
    ...state.project,
    annotations: [...state.project.annotations, annotation],
    pendingAnnotationIds: [...state.project.pendingAnnotationIds, id],
  }
  if (playing) {
    const review = state.review.status === 'active' ? state.review : { status: 'inactive' } as const
    return { state: { ...state, project, review }, effects: [] }
  }

  const resumePosition = state.review.status === 'inactive' ? position : state.review.resumePosition
  const skippedIds = state.review.status === 'active' ? state.review.skippedIds : []
  return {
    state: { ...state, project, review: { status: 'active', currentId: id, skippedIds, resumePosition }, selectedNote: { kind: 'annotation', id } },
    effects: [{ type: 'open-note', id }],
  }
}

/** Pure transition: the caller performs effects in order after flushing the outgoing editor. */
export const domainReducer: DomainReducer = (state, action) => {
  switch (action.type) {
    case 'capture-point':
      return capture(state, action.id, { kind: 'point', time: action.time }, action.time, action.duration, action.playing)
    case 'annotate-selection':
      return capture(state, action.id, { kind: 'range', start: action.start, end: action.end }, action.position, action.duration, action.playing)
    case 'user-paused':
      return state.review.status === 'inactive' && !state.review.deferPendingUntilCapture ? startReview(state, action.position) : unchanged(state)
    case 'playback-ended':
      return state.review.status !== 'active' ? startReview(state, action.position) : unchanged(state)
    case 'select-note':
      if (!state.project.annotations.some((item) => item.id === action.id)) return unchanged(state)
      return { state: { ...state, selectedNote: { kind: 'annotation', id: action.id } }, effects: [{ type: 'open-note', id: action.id }] }
    case 'select-project-note':
      return { state: { ...state, selectedNote: { kind: 'project' } }, effects: [{ type: 'open-project-note' }] }
    case 'select-queue-item': {
      if (!validPosition(action.position) || !state.project.pendingAnnotationIds.includes(action.id)) return unchanged(state)
      const review: Extract<ReviewPass, { status: 'active' }> = {
        status: 'active', currentId: action.id, resumePosition: state.review.status === 'inactive' ? action.position : state.review.resumePosition,
        skippedIds: state.review.status === 'active' ? state.review.skippedIds.filter((id) => id !== action.id) : [],
      }
      return openReviewItem(state, action.id, review)
    }
    case 'review-pending':
      return state.review.status === 'active' || !validPosition(action.position) ? unchanged(state) : startReview(state, state.review.status === 'finished' ? state.review.resumePosition : action.position)
    case 'done-next':
    case 'skip': {
      const review = state.review
      if (review.status !== 'active' || state.selectedNote?.kind !== 'annotation' || state.selectedNote.id !== review.currentId || !state.project.pendingAnnotationIds.includes(review.currentId)) return unchanged(state)
      if (action.type === 'skip') return advanceReview(state, { ...review, skippedIds: [...review.skippedIds, review.currentId] })
      const project = { ...state.project, pendingAnnotationIds: state.project.pendingAnnotationIds.filter((id) => id !== review.currentId) }
      return advanceReview({ ...state, project }, review)
    }
    case 'delete-annotation': {
      const annotationIndex = state.project.annotations.findIndex((item) => item.id === action.id)
      if (annotationIndex < 0) return unchanged(state)
      const annotation = state.project.annotations[annotationIndex]
      const pendingIndex = state.project.pendingAnnotationIds.indexOf(action.id)
      const project = { ...state.project, annotations: state.project.annotations.filter((item) => item.id !== action.id), pendingAnnotationIds: state.project.pendingAnnotationIds.filter((id) => id !== action.id) }
      const selectedNote = state.selectedNote?.kind === 'annotation' && state.selectedNote.id === action.id ? null : state.selectedNote
      const nextState: DomainState = { ...state, project, selectedNote, undoDelete: { annotation, annotationIndex, pendingIndex: pendingIndex < 0 ? null : pendingIndex } }
      if (state.review.status === 'active') {
        // Keep skipped IDs until the pass ends so undo cannot silently un-skip one.
        const review = state.review
        if (review.currentId === action.id) return advanceReview(nextState, review)
        return { state: { ...nextState, review }, effects: [] }
      }
      const effects: DomainEffect[] = state.review.status === 'finished'
        ? [{ type: 'offer-review-result', pendingCount: project.pendingAnnotationIds.length, resumePosition: state.review.resumePosition }]
        : []
      return { state: nextState, effects }
    }
    case 'undo-delete': {
      const deleted = state.undoDelete
      if (!deleted || state.project.annotations.some((item) => item.id === deleted.annotation.id)) return unchanged(state)
      const annotations = [...state.project.annotations]
      annotations.splice(deleted.annotationIndex, 0, deleted.annotation)
      const pendingAnnotationIds = [...state.project.pendingAnnotationIds]
      if (deleted.pendingIndex !== null) pendingAnnotationIds.splice(deleted.pendingIndex, 0, deleted.annotation.id)
      const project = { ...state.project, annotations, pendingAnnotationIds }
      const effects: DomainEffect[] = state.review.status === 'finished'
        ? [{ type: 'offer-review-result', pendingCount: pendingAnnotationIds.length, resumePosition: state.review.resumePosition }]
        : []
      return { state: { ...state, project, undoDelete: null }, effects }
    }
    case 'resume-listening':
      if (state.review.status !== 'finished') return unchanged(state)
      return { state: { ...state, review: state.project.pendingAnnotationIds.length ? { status: 'inactive', deferPendingUntilCapture: true } : { status: 'inactive' } }, effects: [{ type: 'seek', time: state.review.resumePosition }] }
    case 'update-anchor': {
      if (!isValidAnchor(action.anchor, action.duration)) return unchanged(state)
      const index = state.project.annotations.findIndex((item) => item.id === action.id)
      if (index < 0) return unchanged(state)
      const annotations = [...state.project.annotations]
      annotations[index] = { ...annotations[index], anchor: { ...action.anchor } }
      return { state: { ...state, project: { ...state.project, annotations } }, effects: [] }
    }
    case 'update-note': {
      if (action.target.kind === 'project') return { state: { ...state, project: { ...state.project, projectNote: action.note } }, effects: [] }
      const id = action.target.id
      const index = state.project.annotations.findIndex((item) => item.id === id)
      if (index < 0) return unchanged(state)
      const annotations = [...state.project.annotations]
      annotations[index] = { ...annotations[index], note: action.note }
      return { state: { ...state, project: { ...state.project, annotations } }, effects: [] }
    }
  }
}
