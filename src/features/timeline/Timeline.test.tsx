// @vitest-environment jsdom
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import type { Annotation } from '../../contracts/project'
import { Timeline, type TimelineHandle } from './Timeline'

const fake = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  let position = 0
  let playing = false
  const fire = (type: string, ...args: unknown[]) => listeners.get(type)?.forEach((listener) => listener(...args))
  const wave = {
    on: (name: string, listener: (...args: unknown[]) => void) => {
      const set = listeners.get(name) ?? new Set(); set.add(listener); listeners.set(name, set)
      return () => set.delete(listener)
    },
    load: vi.fn(async () => { fire('ready', 10) }),
    play: vi.fn(async () => { playing = true; fire('play') }),
    pause: vi.fn(() => { playing = false; fire('pause') }),
    setTime: vi.fn((time: number) => { position = time; fire('timeupdate', time) }),
    getCurrentTime: () => position, getDuration: () => 10, isPlaying: () => playing,
    zoom: vi.fn(), destroy: vi.fn(),
  }
  return { wave, fire, stop: () => { playing = false }, reset: () => { listeners.clear(); position = 0; playing = false; vi.clearAllMocks() } }
})
vi.mock('wavesurfer.js', () => ({ default: { create: () => fake.wave } }))

const annotations: Annotation[] = [
  { id: 'a', anchor: { kind: 'point', time: 4 }, note: { blocks: [] } },
  { id: 'b', anchor: { kind: 'point', time: 4 }, note: { blocks: [] } },
]

beforeEach(() => {
  fake.reset()
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 400 })
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, right: 400, width: 400, top: 0, bottom: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) })
  if (!window.PointerEvent) window.PointerEvent = MouseEvent as typeof PointerEvent
})
afterEach(cleanup)

describe('Timeline composition', () => {
  it('uses list item text rather than list metadata in the handle and legend', () => {
    const annotation: Annotation = {
      id: 'list', anchor: { kind: 'point', time: 2 },
      note: { blocks: [{ type: 'list', data: { style: 'unordered', items: [{ content: '<b>Listen</b> &amp; compare', items: [] }] } }] },
    }
    render(<Timeline recordingUrl="/sample.wav" annotations={[annotation]} selectedAnnotationId="list" onAnnotateSelection={vi.fn()} onAnchorChange={vi.fn()} />)
    const handle = screen.getByRole('button', { name: 'Point · 0:02.00 · Listen & compare (list)' })
    expect(handle.getAttribute('title')).toBe('Point · 0:02.00 · Listen & compare · click to open, drag to adjust')
    expect(screen.getByText('Listen & compare · adjust time (seconds)').tagName).toBe('LEGEND')
  })
  it('skips an empty block and empty list item to label the first nested text safely', () => {
    const annotation: Annotation = {
      id: 'nested', anchor: { kind: 'range', start: 2, end: 8 },
      note: { blocks: [
        { type: 'paragraph', data: { text: '<br>' } },
        { type: 'list', data: { style: 'ordered', items: [{ content: '&nbsp;', items: [{ content: '<a href="https://example.com">A &amp; <i>B</i></a>', items: [] }] }] } },
      ] },
    }
    render(<Timeline recordingUrl="/sample.wav" annotations={[annotation]} selectedAnnotationId="nested" onAnnotateSelection={vi.fn()} onAnchorChange={vi.fn()} />)
    const handle = screen.getByRole('button', { name: 'Range start · 0:02.00 · A & B (nested)' })
    expect(handle.getAttribute('title')).toContain('A & B')
    expect(screen.getByText('A & B · adjust time (seconds)').tagName).toBe('LEGEND')
    expect(screen.queryByRole('link')).toBeNull()
  })
  it('keeps long excerpts bounded and uses the pending fallback for empty content', () => {
    const long = 'a'.repeat(100)
    const items: Annotation[] = [
      { id: 'long', anchor: { kind: 'point', time: 2 }, note: { blocks: [{ type: 'paragraph', data: { text: long } }] } },
      { id: 'empty', anchor: { kind: 'point', time: 4 }, note: { blocks: [{ type: 'list', data: { style: 'unordered', items: [] } }] } },
    ]
    render(<Timeline recordingUrl="/sample.wav" annotations={items} selectedAnnotationId="long" onAnnotateSelection={vi.fn()} onAnchorChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: `Point · 0:02.00 · ${'a'.repeat(80)} (long)` })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Point · 0:04.00 · Pending annotation (empty)' })).toBeTruthy()
    expect(screen.getByText(`${'a'.repeat(80)} · adjust time (seconds)`)).toBeTruthy()
  })
  it('makes same-time handles separately selectable without seeking; explicit commands seek and loop', async () => {
    const onEvent = vi.fn()
    const ref = createRef<TimelineHandle>()
    render(<Timeline ref={ref} recordingUrl="asset://copy.wav" annotations={annotations} onEvent={onEvent} onAnnotateSelection={vi.fn()} onAnchorChange={vi.fn()} />)
    const a = await screen.findByRole('button', { name: /Pending annotation \(a\)/ })
    const b = screen.getByRole('button', { name: /Pending annotation \(b\)/ })
    expect(a.style.top).not.toBe(b.style.top)
    fireEvent.click(a, { detail: 0 }); fireEvent.click(b, { detail: 0 })
    expect(onEvent.mock.calls.map(([event]) => event)).toContainEqual({ type: 'annotation-selected', id: 'a' })
    expect(onEvent.mock.calls.map(([event]) => event)).toContainEqual({ type: 'annotation-selected', id: 'b' })
    expect(fake.wave.setTime).not.toHaveBeenCalled()
    await act(async () => { await ref.current?.playFrom(3) })
    expect(ref.current?.getPosition()).toBe(3)
    await act(async () => { await ref.current?.loopRange({ start: 6, end: 8 }) })
    expect(ref.current?.getPosition()).toBe(6)
  })
  it('keeps drag selection temporary until annotation is explicitly requested', async () => {
    const onAnnotateSelection = vi.fn(), onEvent = vi.fn()
    const { container } = render(<Timeline recordingUrl="/sample.wav" annotations={[]} onEvent={onEvent} onAnnotateSelection={onAnnotateSelection} onAnchorChange={vi.fn()} />)
    await screen.findByText('0:00.00 / 0:10.00')
    const wave = container.querySelector('.wn-wave')!
    fireEvent.pointerDown(wave, { button: 0, clientX: 80, pointerId: 1 })
    fireEvent.pointerMove(wave, { clientX: 240, pointerId: 1 })
    fireEvent.pointerUp(wave, { clientX: 240, pointerId: 1 })
    expect(onAnnotateSelection).not.toHaveBeenCalled()
    expect(onEvent.mock.calls.map(([event]) => event)).toContainEqual({ type: 'selection-changed', selection: { start: 2, end: 6 } })
    fireEvent.click(screen.getByRole('button', { name: 'Annotate selection' }))
    expect(onAnnotateSelection).toHaveBeenCalledWith({ start: 2, end: 6 })
  })
  it('commits point dragging and precise range edits through the callback', async () => {
    const onAnchorChange = vi.fn()
    const range: Annotation = { id: 'range', anchor: { kind: 'range', start: 2, end: 8 }, note: { blocks: [] } }
    const { rerender } = render(<Timeline recordingUrl="/sample.wav" annotations={annotations} onAnnotateSelection={vi.fn()} onAnchorChange={onAnchorChange} />)
    const point = await screen.findByRole('button', { name: /Pending annotation \(a\)/ })
    fireEvent.pointerDown(point, { button: 0, clientX: 160, pointerId: 1 })
    // Pointer capture is simulated by dispatching on the common content node.
    fireEvent.pointerMove(point.parentElement!.parentElement!, { clientX: 200, pointerId: 1 })
    fireEvent.pointerUp(point.parentElement!.parentElement!, { clientX: 200, pointerId: 1 })
    expect(onAnchorChange).toHaveBeenCalledWith('a', { kind: 'point', time: 5 }, 10)
    rerender(<Timeline recordingUrl="/sample.wav" annotations={[range]} selectedAnnotationId="range" onAnnotateSelection={vi.fn()} onAnchorChange={onAnchorChange} />)
    const start = screen.getByLabelText('Start')
    fireEvent.change(start, { target: { value: '2.125' } }); fireEvent.blur(start)
    expect(onAnchorChange).toHaveBeenCalledWith('range', { kind: 'range', start: 2.125, end: 8 }, 10)
  })
  it('moves a clamped zero-time handle by the drag delta, not the grab position', async () => {
    const onAnchorChange = vi.fn()
    const annotation: Annotation = { id: 'zero', anchor: { kind: 'point', time: 0 }, note: { blocks: [] } }
    render(<Timeline recordingUrl="/sample.wav" annotations={[annotation]} onAnnotateSelection={vi.fn()} onAnchorChange={onAnchorChange} />)
    const handle = await screen.findByRole('button', { name: /Pending annotation \(zero\)/ })
    const content = handle.parentElement!.parentElement!
    fireEvent.pointerDown(handle, { button: 0, clientX: 17, pointerId: 1 })
    fireEvent.pointerMove(content, { clientX: 21, pointerId: 1 })
    fireEvent.pointerUp(content, { clientX: 21, pointerId: 1 })
    expect(onAnchorChange).toHaveBeenCalledWith('zero', { kind: 'point', time: 0.1 }, 10)
  })
  it('preserves an off-center grab and clamps a recording-end handle', async () => {
    const onAnchorChange = vi.fn()
    const range: Annotation = { id: 'range', anchor: { kind: 'range', start: 2, end: 10 }, note: { blocks: [] } }
    render(<Timeline recordingUrl="/sample.wav" annotations={[range]} onAnnotateSelection={vi.fn()} onAnchorChange={onAnchorChange} />)
    const end = await screen.findByRole('button', { name: /Range end.*\(range\)/ })
    const content = end.parentElement!.parentElement!
    fireEvent.pointerDown(end, { button: 0, clientX: 375, pointerId: 1 })
    fireEvent.pointerMove(content, { clientX: 371, pointerId: 1 })
    fireEvent.pointerUp(content, { clientX: 371, pointerId: 1 })
    expect(onAnchorChange).toHaveBeenCalledWith('range', { kind: 'range', start: 2, end: 9.9 }, 10)
    fireEvent.pointerDown(end, { button: 0, clientX: 375, pointerId: 2 })
    fireEvent.pointerUp(content, { clientX: 395, pointerId: 2 })
    expect(onAnchorChange).toHaveBeenLastCalledWith('range', { kind: 'range', start: 2, end: 10 }, 10)
  })
  it('includes viewport scrolling during a captured handle drag', async () => {
    const onAnchorChange = vi.fn()
    render(<Timeline recordingUrl="/sample.wav" annotations={annotations} onAnnotateSelection={vi.fn()} onAnchorChange={onAnchorChange} />)
    const handle = await screen.findByRole('button', { name: /Pending annotation \(a\)/ })
    const content = handle.parentElement!.parentElement!
    let left = 0
    vi.spyOn(content, 'getBoundingClientRect').mockImplementation(() => ({ left, right: left + 400, width: 400, top: 0, bottom: 100, height: 100, x: left, y: 0, toJSON: () => ({}) }))
    fireEvent.pointerDown(handle, { button: 0, clientX: 167, pointerId: 1 })
    left = -40
    fireEvent.pointerMove(content, { clientX: 167, pointerId: 1 })
    fireEvent.pointerUp(content, { clientX: 167, pointerId: 1 })
    expect(onAnchorChange).toHaveBeenCalledWith('a', { kind: 'point', time: 5 }, 10)
  })
  it('shows Play after a seek-to-end pause without starting review', async () => {
    const onEvent = vi.fn()
    const ref = createRef<TimelineHandle>()
    render(<Timeline ref={ref} recordingUrl="/sample.wav" annotations={[]} onEvent={onEvent} onAnnotateSelection={vi.fn()} onAnchorChange={vi.fn()} />)
    await screen.findByText('0:00.00 / 0:10.00')
    await act(async () => { await ref.current?.play() })
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    act(() => { ref.current?.seek(10); fake.stop(); fake.fire('pause'); fake.fire('finish') })
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
    expect(onEvent.mock.calls.map(([event]) => event)).toContainEqual({ type: 'paused', position: 10 })
    expect(onEvent.mock.calls.some(([event]) => event.type === 'ended' || event.type === 'user-paused')).toBe(false)
  })
})
