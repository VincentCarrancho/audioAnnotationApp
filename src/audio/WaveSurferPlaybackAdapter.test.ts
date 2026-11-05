import { describe, expect, it, vi } from 'vitest'
import type { PlaybackEvent } from '../contracts/playback'
import { WaveSurferPlaybackAdapter, type WaveSurferPlayer } from './WaveSurferPlaybackAdapter'

function fixture() {
  const handlers = new Map<string, Set<(...args: never[]) => void>>()
  let playing = false
  let position = 0
  const wave = {
    on: (name: string, listener: (...args: never[]) => void) => {
      const set = handlers.get(name) ?? new Set()
      set.add(listener); handlers.set(name, set)
      return () => set.delete(listener)
    },
    load: vi.fn(async () => {}), play: vi.fn(async () => { playing = true; fire('play') }),
    pause: vi.fn(() => { playing = false; fire('pause') }), setTime: vi.fn((time: number) => { position = time }),
    getCurrentTime: () => position, getDuration: () => 10, isPlaying: () => playing,
    zoom: vi.fn(), destroy: vi.fn(),
  }
  function fire(name: string, ...args: unknown[]) { handlers.get(name)?.forEach((listener) => listener(...args as never[])) }
  const adapter = new WaveSurferPlaybackAdapter(wave as unknown as WaveSurferPlayer)
  const events: PlaybackEvent[] = []
  const unsubscribe = adapter.subscribe((event) => events.push(event))
  return { wave, adapter, events, fire, unsubscribe, setPosition: (time: number) => { position = time }, stop: () => { playing = false } }
}

describe('WaveSurferPlaybackAdapter', () => {
  it('only emits a review pause on explicit user pause while playing', async () => {
    const f = fixture()
    await f.adapter.load('asset://recording.wav')
    expect(f.wave.load).toHaveBeenCalledWith('asset://recording.wav')
    await f.adapter.play()
    f.adapter.seek(4)
    f.fire('pause') // media-generated pause, not user intent
    f.adapter.pause('programmatic')
    expect(f.events.some((event) => event.type === 'user-paused')).toBe(false)
    await f.adapter.play()
    f.adapter.pause('user')
    f.adapter.pause('user')
    expect(f.events.filter((event) => event.type === 'user-paused')).toEqual([{ type: 'user-paused', position: 4 }])
  })
  it('wraps selected ranges and suppresses end review, including ranges ending at the recording end', async () => {
    const f = fixture()
    f.adapter.setLoop({ start: 2, end: 5 })
    await f.adapter.play()
    expect(f.wave.setTime).toHaveBeenCalledWith(2)
    f.setPosition(5); f.fire('timeupdate', 5)
    expect(f.adapter.getPosition()).toBe(2)
    expect(f.events.filter((event) => event.type === 'loop-boundary')).toHaveLength(1)
    f.adapter.setLoop({ start: 8, end: 10 })
    f.setPosition(10); f.stop(); f.fire('finish')
    expect(f.adapter.getPosition()).toBe(8)
    expect(f.events.some((event) => event.type === 'ended')).toBe(false)
    f.adapter.setLoop(null)
    f.setPosition(10); f.fire('finish')
    expect(f.events.at(-1)).toEqual({ type: 'ended', position: 10 })
  })
  it('does not duplicate a boundary when a delayed finish follows a wrapped timeupdate', async () => {
    const f = fixture()
    f.adapter.setLoop({ start: 1, end: 10 }); await f.adapter.play()
    f.setPosition(10); f.fire('timeupdate', 10); f.stop(); f.fire('finish')
    expect(f.events.filter((event) => event.type === 'loop-boundary')).toHaveLength(1)
    expect(f.events.some((event) => event.type === 'ended')).toBe(false)
  })
  it('does not start review when seeking to the end, but does after later natural playback', async () => {
    const f = fixture()
    await f.adapter.play()
    f.adapter.seek(10); f.fire('finish')
    expect(f.events.some((event) => event.type === 'ended')).toBe(false)
    f.adapter.seek(3); f.setPosition(10); f.fire('timeupdate', 10); f.fire('finish')
    expect(f.events.filter((event) => event.type === 'ended')).toEqual([{ type: 'ended', position: 10 }])
  })
  it('cleans up every listener and does not notify unsubscribed observers', () => {
    const f = fixture()
    f.unsubscribe(); f.fire('ready', 10)
    expect(f.events).toEqual([])
    const listener = vi.fn(); f.adapter.subscribe(listener)
    f.adapter.destroy(); f.adapter.destroy(); f.fire('ready', 10)
    expect(listener).not.toHaveBeenCalled()
    expect(f.wave.destroy).toHaveBeenCalledOnce()
  })
  it('reports load and play failures to the subscriber', async () => {
    const f = fixture()
    f.wave.load.mockRejectedValueOnce(new Error('load failed'))
    await expect(f.adapter.load('bad')).rejects.toThrow('load failed')
    f.wave.play.mockRejectedValueOnce(new Error('play failed'))
    await expect(f.adapter.play()).rejects.toThrow('play failed')
    expect(f.events.filter((event) => event.type === 'error')).toEqual([{ type: 'error', message: 'load failed' }, { type: 'error', message: 'play failed' }])
  })
})
