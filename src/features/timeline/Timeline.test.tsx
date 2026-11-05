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
  return { wave, fire, reset: () => { listeners.clear(); position = 0; playing = false; vi.clearAllMocks() } }
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
})
