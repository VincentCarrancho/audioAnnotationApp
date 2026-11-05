// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DomainState } from '../../contracts'
import { QueuePanel } from './QueuePanel'

afterEach(cleanup)

function state(): DomainState {
  return {
    project: { version: 1, id: 'p', name: 'P', recording: { relativePath: 'a.wav' }, projectNote: { blocks: [] },
      annotations: [
        { id: 'a', anchor: { kind: 'point', time: 80 }, note: { blocks: [] } },
        { id: 'b', anchor: { kind: 'point', time: 10 }, note: { blocks: [{ type: 'paragraph', data: { text: '<b>Early</b>' } }] } },
      ], pendingAnnotationIds: ['a', 'b'] },
    selectedNote: { kind: 'annotation', id: 'b' },
    review: { status: 'active', currentId: 'a', skippedIds: [], resumePosition: 100 },
    undoDelete: null,
  }
}

describe('focus queue', () => {
  it('shows capture order and cannot complete a hidden active item', () => {
    render(<QueuePanel state={state()} position={10} beforeAction={async () => {}} onAction={() => {}} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons[0].textContent).toContain('1:20')
    expect(buttons[0].textContent).toContain('Pending annotation')
    expect(buttons[1].textContent).toContain('Early')
    expect(screen.queryByRole('button', { name: /Done/ })).toBeNull()
    expect(screen.getByText(/not currently open/)).toBeTruthy()
  })

  it('flushes before completing, including empty notes, and reports errors', async () => {
    const current = state()
    current.selectedNote = { kind: 'annotation', id: 'a' }
    const beforeAction = vi.fn().mockRejectedValueOnce(new Error('serialize failed')).mockResolvedValue(undefined)
    const onAction = vi.fn()
    render(<QueuePanel state={current} position={10} beforeAction={beforeAction} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: /Done/ }))
    await screen.findByRole('alert')
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Done/ }))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'done-next' }))
  })

  it('offers explicit review and resume after a finished pass', () => {
    const current = state()
    current.review = { status: 'finished', resumePosition: 100 }
    render(<QueuePanel state={current} position={10} beforeAction={async () => {}} onAction={() => {}} />)
    expect(screen.getByRole('button', { name: 'Review pending' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume listening' })).toBeTruthy()
  })

  it('sends the live position when explicitly selecting an item from the queue', async () => {
    const current = state()
    current.review = { status: 'inactive' }
    const onAction = vi.fn()
    render(<QueuePanel state={current} position={37.5} beforeAction={async () => {}} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: /1:20/ }))
    await waitFor(() => expect(onAction).toHaveBeenCalledWith({ type: 'select-queue-item', id: 'a', position: 37.5 }))
  })
})
