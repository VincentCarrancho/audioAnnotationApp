import WaveSurfer from 'wavesurfer.js'
import type { PlaybackAdapter, PlaybackEvent, TimeRange } from '../contracts/playback'

/** The narrow WaveSurfer seam also allows media-event behavior to be tested without a decoder. */
export type WaveSurferPlayer = Pick<WaveSurfer, 'on' | 'load' | 'play' | 'pause' | 'setTime' | 'getCurrentTime' | 'getDuration' | 'isPlaying' | 'zoom' | 'destroy'>

function waveformPalette(container: HTMLElement) {
  const fallback = { waveColor: '#888888', progressColor: '#555555', cursorColor: '#222222' }
  try {
    const document = container.ownerDocument
    const view = document?.defaultView
    if (!view || typeof view.getComputedStyle !== 'function') return fallback
    const containerStyle = view.getComputedStyle(container)
    const rootStyle = document.documentElement === container ? containerStyle : view.getComputedStyle(document.documentElement)
    const color = (token: string, defaultColor: string) => {
      const resolved = containerStyle.getPropertyValue(token).trim() || rootStyle.getPropertyValue(token).trim()
      // Canvas colors must not receive unresolved custom-property expressions.
      return resolved && !/var\s*\(/i.test(resolved) ? resolved : defaultColor
    }
    return {
      waveColor: color('--color-wave', fallback.waveColor),
      progressColor: color('--color-wave-progress', fallback.progressColor),
      cursorColor: color('--color-wave-cursor', fallback.cursorColor),
    }
  } catch {
    return fallback
  }
}

export class WaveSurferPlaybackAdapter implements PlaybackAdapter {
  private listeners = new Set<(event: PlaybackEvent) => void>()
  private subscriptions: Array<() => void> = []
  private loop: TimeRange | null = null
  private destroyed = false
  private loading = false
  private loadErrorEmitted = false
  private seekedToEnd = false
  private playing = false
  private loopEndWrapPending = false
  private pauseRequested = false
  private explicitlyPaused = false

  constructor(private readonly wave: WaveSurferPlayer) {
    this.subscriptions = [
      wave.on('ready', (duration) => this.emit({ type: 'ready', duration })),
      wave.on('play', () => { this.explicitlyPaused = false; this.playing = true; this.emit({ type: 'playing' }) }),
      wave.on('pause', () => {
        const atLoopEnd = this.loop && (this.getPosition() >= this.loop.end || this.loopEndWrapPending)
        if (!this.wave.isPlaying() && (this.pauseRequested || !atLoopEnd)) this.emitPaused()
      }),
      wave.on('timeupdate', (time) => {
        if (this.loading) return
        if (time < this.wave.getDuration()) this.seekedToEnd = false
        if (this.loop && time > this.loop.start && time < this.loop.end) this.loopEndWrapPending = false
        if (this.loop && this.wave.isPlaying() && time >= this.loop.end) {
          this.wrapLoop()
          return
        }
        this.emit({ type: 'position', time })
      }),
      wave.on('finish', () => {
        if (this.loading) return
        if (this.loop) {
          if (!this.playing) return
          // A finish can arrive after a timeupdate already wrapped the playhead.
          if (this.getPosition() >= this.loop.end) this.wrapLoop()
          if (!this.wave.isPlaying()) void this.play().catch(() => {})
        } else {
          this.emitPaused()
          if (!this.seekedToEnd && !this.explicitlyPaused) this.emit({ type: 'ended', position: this.getPosition() })
        }
      }),
      wave.on('error', (error) => {
        if (this.loading) this.loadErrorEmitted = true
        this.emit({ type: 'error', message: error.message })
      }),
    ]
  }

  static create(container: HTMLElement): WaveSurferPlaybackAdapter {
    return new WaveSurferPlaybackAdapter(WaveSurfer.create({
      container, height: 116, ...waveformPalette(container),
      cursorWidth: 2, interact: false, autoScroll: false,
    }))
  }

  async load(url: string): Promise<void> {
    this.loop = null
    this.loading = true
    this.loadErrorEmitted = false
    this.seekedToEnd = false
    this.loopEndWrapPending = false
    this.explicitlyPaused = true
    try { await this.wave.load(url) } catch (error) {
      if (!this.loadErrorEmitted) this.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      throw error
    } finally { this.loading = false }
  }

  async play(): Promise<void> {
    if (this.loop && (this.getPosition() < this.loop.start || this.getPosition() >= this.loop.end)) this.seek(this.loop.start)
    try { await this.wave.play() } catch (error) {
      if (!this.wave.isPlaying()) this.emitPaused()
      this.emit({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  pause(reason: 'user' | 'programmatic'): void {
    const wasPlaying = this.wave.isPlaying() || this.playing
    this.explicitlyPaused = true
    this.pauseRequested = true
    try { this.wave.pause() } finally { this.pauseRequested = false }
    if (wasPlaying && !this.wave.isPlaying()) this.emitPaused()
    if (reason === 'user' && wasPlaying) this.emit({ type: 'user-paused', position: this.getPosition() })
  }

  seek(time: number): void {
    if (!Number.isFinite(time)) return
    const duration = this.wave.getDuration()
    const bounded = Math.max(0, Math.min(Number.isFinite(duration) ? duration : 0, time))
    this.seekedToEnd = duration > 0 && bounded >= duration
    this.wave.setTime(bounded)
  }

  setLoop(range: TimeRange | null): void {
    const duration = this.wave.getDuration()
    this.loop = range && Number.isFinite(duration) && Number.isFinite(range.start) && Number.isFinite(range.end)
      && range.start >= 0 && range.start < range.end && range.end <= duration ? { ...range } : null
    this.loopEndWrapPending = false
  }
  setZoom(pixelsPerSecond: number): void {
    if (Number.isFinite(pixelsPerSecond) && pixelsPerSecond > 0) this.wave.zoom(pixelsPerSecond)
  }
  fit(): void { this.wave.zoom(0) }
  getPosition(): number { return this.wave.getCurrentTime() }
  subscribe(listener: (event: PlaybackEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  /** UI-only events share the same subscription stream as transport events. */
  selectionChanged(selection: TimeRange | null): void { this.emit({ type: 'selection-changed', selection }) }
  annotationSelected(id: string): void { this.emit({ type: 'annotation-selected', id }) }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.subscriptions.forEach((unsubscribe) => unsubscribe())
    this.listeners.clear()
    this.wave.destroy()
  }
  private wrapLoop(): void {
    if (!this.loop) return
    const start = this.loop.start
    this.loopEndWrapPending = this.loop.end >= this.wave.getDuration()
    this.wave.setTime(start)
    this.emit({ type: 'loop-boundary', position: start })
    this.emit({ type: 'position', time: start })
  }
  private emitPaused(): void {
    if (!this.playing) return
    this.playing = false
    this.emit({ type: 'paused', position: this.getPosition() })
  }
  private emit(event: PlaybackEvent): void {
    if (!this.destroyed) this.listeners.forEach((listener) => listener(event))
  }
}
