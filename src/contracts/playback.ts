import type { AnnotationId, Seconds } from './project'

export interface TimeRange { start: Seconds; end: Seconds }

/** Only user-paused and ended may trigger review; looping/seek/load do not. */
export type PlaybackEvent =
  | { type: 'ready'; duration: Seconds }
  | { type: 'position'; time: Seconds }
  | { type: 'playing' }
  /** Playback stopped; observational only, never starts review. */
  | { type: 'paused'; position: Seconds }
  | { type: 'user-paused'; position: Seconds }
  | { type: 'ended'; position: Seconds }
  | { type: 'loop-boundary'; position: Seconds }
  | { type: 'selection-changed'; selection: TimeRange | null }
  | { type: 'annotation-selected'; id: AnnotationId }
  | { type: 'error'; message: string }

export interface PlaybackAdapter {
  /** Load a URL approved for the current webview. It may be an asset-protocol URL. */
  load(url: string): Promise<void>
  play(): Promise<void>
  /** Emits observational paused on a stop; user-paused only for explicit user intent. */
  pause(reason: 'user' | 'programmatic'): void
  seek(time: Seconds): void
  setLoop(range: TimeRange | null): void
  setZoom(pixelsPerSecond: number): void
  fit(): void
  getPosition(): Seconds
  subscribe(listener: (event: PlaybackEvent) => void): () => void
  destroy(): void
}
