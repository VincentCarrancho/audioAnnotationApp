import { describe, expect, it, vi } from 'vitest'
import WaveSurfer from 'wavesurfer.js'
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
  it('creates with grayscale fallbacks without a DOM', () => {
    const create = vi.spyOn(WaveSurfer, 'create').mockReturnValue({ on: () => () => {} } as unknown as WaveSurfer)
    try {
      WaveSurferPlaybackAdapter.create({} as HTMLElement)
      expect(create.mock.calls[0][0]).toMatchObject({
        waveColor: '#888888', progressColor: '#555555', cursorColor: '#222222',
      })
    } finally { create.mockRestore() }
  })
  it('only emits a review pause on explicit user pause while playing', async () => {
    const f = fixture()
    await f.adapter.load('asset://recording.wav')
    expect(f.wave.load).toHaveBeenCalledWith('asset://recording.wav')
    await f.adapter.play()
    f.adapter.seek(4)
    f.stop(); f.fire('pause') // media-generated pause, not user intent
    await f.adapter.play()
    f.adapter.pause('programmatic')
    expect(f.events.some((event) => event.type === 'user-paused')).toBe(false)
    await f.adapter.play()
    f.adapter.pause('user')
    f.adapter.pause('user')
    expect(f.events.filter((event) => event.type === 'user-paused')).toEqual([{ type: 'user-paused', position: 4 }])
  })
  it('reports programmatic pause without a review-triggering user pause', async () => {
    const f = fixture()
    await f.adapter.play()
    f.adapter.seek(4)
    f.adapter.pause('programmatic')
    expect(f.events).toContainEqual({ type: 'paused', position: 4 })
    expect(f.events.some((event) => event.type === 'user-paused')).toBe(false)
  })
  it('deduplicates delayed media pause notifications, including after playback resumes', async () => {
    const f = fixture()
    f.wave.pause.mockImplementation(() => { f.stop() }) // media pause event arrives later
    await f.adapter.play(); f.adapter.pause('programmatic')
    f.fire('pause')
    await f.adapter.play(); f.fire('pause')
    expect(f.events.filter((event) => event.type === 'paused')).toEqual([{ type: 'paused', position: 0 }])
    expect(f.events.at(-1)).toEqual({ type: 'playing' })
  })
  it('does not translate a delayed finish after a programmatic pause into review', async () => {
    const f = fixture()
    await f.adapter.play(); f.adapter.seek(9)
    f.adapter.pause('programmatic'); f.setPosition(10); f.fire('finish')
    expect(f.events.some((event) => event.type === 'ended' || event.type === 'user-paused')).toBe(false)
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
  it('does not report a transient loop-end media pause as a stopped transport', async () => {
    const f = fixture()
    f.adapter.setLoop({ start: 2, end: 10 })
    await f.adapter.play()
    f.setPosition(10); f.fire('timeupdate', 10)
    f.stop(); f.fire('pause'); f.fire('finish')
    expect(f.events.some((event) => event.type === 'paused' || event.type === 'user-paused' || event.type === 'ended')).toBe(false)
    expect(f.events.at(-1)).toEqual({ type: 'playing' })
  })
  it('restarts a loop when media pauses at the end before emitting finish', async () => {
    const f = fixture()
    f.adapter.setLoop({ start: 2, end: 10 }); await f.adapter.play()
    f.setPosition(10); f.stop(); f.fire('pause'); f.fire('finish')
    expect(f.adapter.getPosition()).toBe(2)
    expect(f.events.some((event) => event.type === 'paused' || event.type === 'ended')).toBe(false)
    expect(f.events.at(-1)).toEqual({ type: 'playing' })
  })
  it('does not restart a loop after explicit pause during a pending loop finish', async () => {
    const f = fixture()
    f.adapter.setLoop({ start: 2, end: 10 }); await f.adapter.play()
    f.setPosition(10); f.stop(); f.fire('pause')
    f.adapter.pause('user')
    f.fire('finish')
    expect(f.events.filter((event) => event.type === 'paused')).toEqual([{ type: 'paused', position: 10 }])
    expect(f.events.filter((event) => event.type === 'user-paused')).toEqual([{ type: 'user-paused', position: 10 }])
    expect(f.wave.play).toHaveBeenCalledTimes(1)
  })
  it('does not start review when seeking to the end, but does after later natural playback', async () => {
    const f = fixture()
    await f.adapter.play()
    f.adapter.seek(10); f.fire('finish')
    expect(f.events.some((event) => event.type === 'ended')).toBe(false)
    f.adapter.seek(3); f.setPosition(10); f.fire('timeupdate', 10); f.fire('finish')
    expect(f.events.filter((event) => event.type === 'ended')).toEqual([{ type: 'ended', position: 10 }])
  })
  it('reports a seek-to-end finish as paused even if the media emits no pause event', async () => {
    const f = fixture()
    await f.adapter.play()
    f.adapter.seek(10); f.stop(); f.fire('finish')
    expect(f.events).toContainEqual({ type: 'paused', position: 10 })
    expect(f.events.some((event) => event.type === 'ended' || event.type === 'user-paused')).toBe(false)
    f.fire('pause')
    expect(f.events.filter((event) => event.type === 'paused')).toHaveLength(1)
  })
  it('reports one paused event and an ended event for a natural non-looping finish', async () => {
    const f = fixture()
    await f.adapter.play()
    f.setPosition(10); f.stop(); f.fire('pause'); f.fire('finish')
    expect(f.events.filter((event) => event.type === 'paused')).toEqual([{ type: 'paused', position: 10 }])
    expect(f.events.filter((event) => event.type === 'ended')).toEqual([{ type: 'ended', position: 10 }])
    expect(f.events.some((event) => event.type === 'user-paused')).toBe(false)
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
