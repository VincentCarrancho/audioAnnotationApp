import { describe, expect, it, vi } from 'vitest'
import type { ProjectData, ProjectRepository, ProjectSession } from '../contracts'
import { RevisionWriter, SaveCoordinator } from './index'

function project(name = 'initial'): ProjectData {
  return { version: 1, id: 'p', name, recording: { relativePath: 'recording.wav' }, annotations: [], projectNote: { blocks: [] }, pendingAnnotationIds: [] }
}
function session(): ProjectSession { return { directory: '/project', project: project(), recordingUrl: 'asset://recording' } }
function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('RevisionWriter', () => {
  it('serializes writes, coalesces to the latest snapshot and acknowledges older requests', async () => {
    const first = deferred(), last = deferred()
    const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise)
    const queue = new RevisionWriter(write), s = session()
    const p1 = queue.save(s, project('one'), 1)
    const secondData = project('two')
    const p2 = queue.save(s, secondData, 2)
    const p3 = queue.save(s, project('three'), 3)
    secondData.name = 'mutated after request'
    expect(write).toHaveBeenCalledTimes(1)
    first.resolve()
    await p1
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1][1].name).toBe('three')
    expect(write.mock.calls[1][2]).toBe(3)
    last.resolve()
    await Promise.all([p2, p3])
    await queue.save(s, project('old'), 1)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('preserves the latest snapshot after failure and retries without allowing an older overwrite', async () => {
    const failing = deferred()
    const write = vi.fn().mockReturnValueOnce(failing.promise).mockResolvedValue(undefined)
    const queue = new RevisionWriter(write), s = session()
    const a = queue.save(s, project('one'), 1)
    const b = queue.save(s, project('two'), 2)
    failing.reject(new Error('disk full'))
    await expect(a).rejects.toThrow('disk full')
    await expect(b).rejects.toThrow('disk full')
    await queue.save(s, project('one'), 1)
    expect(write.mock.calls[1][1].name).toBe('two')
    expect(write.mock.calls[1][2]).toBe(2)
    await expect(queue.save(s, project('different'), 2)).rejects.toThrow('reused')
  })
})

describe('SaveCoordinator', () => {
  it('keeps changes made during a write dirty and saves them before resolving', async () => {
    const first = deferred(), last = deferred(), s = session()
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise)
    const repo: ProjectRepository = { create: vi.fn(), open: vi.fn(), save }
    const coordinator = new SaveCoordinator(repo, s)
    coordinator.update(project('one'))
    const done = coordinator.saveLatest()
    coordinator.update(project('two'))
    first.resolve()
    await Promise.resolve()
    expect(coordinator.dirty).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
    last.resolve()
    await done
    expect(coordinator.dirty).toBe(false)
    expect(coordinator.status).toEqual({ state: 'saved', revision: 2 })
  })

  it('reports failure and keeps edits for an explicit retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    const repo: ProjectRepository = { create: vi.fn(), open: vi.fn(), save }
    const coordinator = new SaveCoordinator(repo, session())
    coordinator.update(project('edited'))
    await expect(coordinator.saveLatest()).rejects.toThrow('disk full')
    expect(coordinator.dirty).toBe(true)
    expect(coordinator.status.state).toBe('failed')
    await coordinator.saveLatest()
    expect(coordinator.dirty).toBe(false)
  })

  it('does not miss a change made while a clean save is resolving', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const repo: ProjectRepository = { create: vi.fn(), open: vi.fn(), save }
    const coordinator = new SaveCoordinator(repo, session())
    const clean = coordinator.saveLatest()
    coordinator.update(project('edited'))
    const edited = coordinator.saveLatest()
    await Promise.all([clean, edited])
    expect(save).toHaveBeenCalledTimes(1)
    expect(coordinator.dirty).toBe(false)
  })
})
