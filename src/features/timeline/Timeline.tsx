import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Annotation, AnnotationAnchor } from '../../contracts/project'
import type { PlaybackEvent, TimeRange } from '../../contracts/playback'
import { WaveSurferPlaybackAdapter } from '../../audio'
import { noteExcerpt as extractNoteExcerpt } from '../notes/labels'
import { placeHandles } from './placement'
import './timeline.css'

export interface TimelineProps {
  recordingUrl: string
  annotations: Annotation[]
  selectedAnnotationId?: string | null
  onEvent?: (event: PlaybackEvent) => void
  onAnnotateSelection: (selection: TimeRange) => void
  onAnchorChange: (id: string, anchor: AnnotationAnchor, duration: number) => void
}

/** Commands are explicit: selecting a note never seeks or plays. */
export interface TimelineHandle {
  getPosition(): number
  seek(time: number): void
  play(): Promise<void>
  pause(reason: 'user' | 'programmatic'): void
  playFrom(time: number): Promise<void>
  loopRange(range: TimeRange): Promise<void>
  clearLoop(): void
}

type Handle = { key: string; id: string; part: 'point' | 'start' | 'end'; time: number }
type Drag = { kind: 'selection'; start: number; clientX: number } | { kind: 'handle'; handle: Handle; clientX: number; contentLeft: number; moved: boolean }

function formatTime(time: number) {
  if (!Number.isFinite(time)) return '0:00.00'
  const minutes = Math.floor(time / 60)
  return `${minutes}:${(time - minutes * 60).toFixed(2).padStart(5, '0')}`
}

function noteExcerpt(annotation: Annotation): string {
  return extractNoteExcerpt(annotation.note).slice(0, 80) || 'Pending annotation'
}

export const Timeline = forwardRef<TimelineHandle, TimelineProps>(function Timeline(props, ref) {
  const callbacks = useRef(props)
  callbacks.current = props
  const waveContainer = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const adapter = useRef<WaveSurferPlaybackAdapter | null>(null)
  const drag = useRef<Drag | null>(null)
  const lastGestureDragged = useRef(false)
  const suppressDoubleClick = useRef(false)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<TimeRange | null>(null)
  const [loop, setLoop] = useState<TimeRange | null>(null)
  const [zoom, setZoom] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [dragPreview, setDragPreview] = useState<{ key: string; time: number } | null>(null)

  useEffect(() => {
    if (!waveContainer.current) return
    let active = true
    const player = WaveSurferPlaybackAdapter.create(waveContainer.current)
    adapter.current = player
    setDuration(0); setPosition(0); setPlaying(false); setError(null); setSelection(null); setLoop(null); setZoom(0)
    const unsubscribe = player.subscribe((event) => {
      if (!active) return
      if (event.type === 'ready') setDuration(event.duration)
      if (event.type === 'position') setPosition(event.time)
      if (event.type === 'playing') setPlaying(true)
      if (event.type === 'paused' || event.type === 'user-paused' || event.type === 'ended') setPlaying(false)
      if (event.type === 'error') setError(event.message)
      callbacks.current.onEvent?.(event)
    })
    void player.load(props.recordingUrl).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false; unsubscribe(); player.destroy(); if (adapter.current === player) adapter.current = null }
  }, [props.recordingUrl])

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const update = () => setViewportWidth(element.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', update); return () => window.removeEventListener('resize', update) }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const contentWidth = Math.max(viewportWidth, duration * zoom, 1)
  const currentPlayer = () => adapter.current
  const startLoop = async (range: TimeRange) => {
    if (!(Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= 0 && range.start < range.end && range.end <= duration)) return
    const player = currentPlayer()
    if (!player) return
    player.setLoop(range); setLoop(range); player.seek(range.start); await player.play()
  }
  const clearLoop = () => { currentPlayer()?.setLoop(null); setLoop(null) }
  const pause = (reason: 'user' | 'programmatic') => { currentPlayer()?.pause(reason); setPlaying(false) }
  useImperativeHandle(ref, () => ({
    getPosition: () => currentPlayer()?.getPosition() ?? 0,
    seek: (time) => currentPlayer()?.seek(time),
    play: async () => { await currentPlayer()?.play() },
    pause,
    playFrom: async (time) => { clearLoop(); currentPlayer()?.seek(time); await currentPlayer()?.play() },
    loopRange: startLoop,
    clearLoop,
  }))

  const handles = useMemo(() => props.annotations.flatMap((annotation): Handle[] => {
    const anchor = annotation.anchor
    return anchor.kind === 'point'
      ? [{ key: `${annotation.id}:point`, id: annotation.id, part: 'point', time: anchor.time }]
      : [{ key: `${annotation.id}:start`, id: annotation.id, part: 'start', time: anchor.start }, { key: `${annotation.id}:end`, id: annotation.id, part: 'end', time: anchor.end }]
  }), [props.annotations])
  const placements = placeHandles(handles.map((handle) => ({ key: handle.key, group: handle.part === 'point' ? undefined : handle.id, x: (dragPreview?.key === handle.key ? dragPreview.time : handle.time) / (duration || 1) * contentWidth, width: 34 })), contentWidth)
  const placementByKey = new Map(placements.map((placement) => [placement.key, placement]))
  const rowCount = placements.reduce((count, placement) => Math.max(count, placement.row + 1), 0)
  const selected = props.annotations.find((annotation) => annotation.id === props.selectedAnnotationId)

  function timeAt(clientX: number) {
    const rect = content.current?.getBoundingClientRect()
    if (!rect || !duration || !rect.width) return 0
    return Math.max(0, Math.min(duration, (clientX - rect.left) / rect.width * duration))
  }
  function handleDelta(current: Extract<Drag, { kind: 'handle' }>, clientX: number) {
    const rect = content.current?.getBoundingClientRect()
    if (!rect || !rect.width) return { pixels: 0, time: current.handle.time }
    const pixels = clientX - current.clientX + current.contentLeft - rect.left
    return { pixels, time: Math.max(0, Math.min(duration, current.handle.time + pixels / rect.width * duration)) }
  }
  function publishSelection(value: TimeRange | null) { setSelection(value); currentPlayer()?.selectionChanged(value) }
  function handleAnchor(handle: Handle, time: number) {
    const annotation = callbacks.current.annotations.find((item) => item.id === handle.id)
    if (!annotation) return
    const anchor = annotation.anchor
    const next: AnnotationAnchor = anchor.kind === 'point' ? { kind: 'point', time }
      : handle.part === 'start' ? { ...anchor, start: time } : { ...anchor, end: time }
    if (next.kind === 'range' && next.start >= next.end) return
    callbacks.current.onAnchorChange(handle.id, next, duration)
  }
  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !duration) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { kind: 'selection', start: timeAt(event.clientX), clientX: event.clientX }
  }
  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current) return
    if (current.kind === 'handle') {
      const delta = handleDelta(current, event.clientX)
      if (Math.abs(delta.pixels) >= 3) current.moved = true
      setDragPreview({ key: current.handle.key, time: delta.time })
    }
    else if (Math.abs(event.clientX - current.clientX) >= 3) {
      const time = timeAt(event.clientX)
      publishSelection({ start: Math.min(current.start, time), end: Math.max(current.start, time) })
    }
  }
  function pointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const current = drag.current
    drag.current = null
    if (!current) return
    if (current.kind === 'handle') {
      const delta = handleDelta(current, event.clientX)
      setDragPreview(null)
      lastGestureDragged.current = current.moved || Math.abs(delta.pixels) >= 3
      if (lastGestureDragged.current) {
        suppressDoubleClick.current = true
        if (Math.abs(delta.pixels) >= 3) handleAnchor(current.handle, delta.time)
      } else currentPlayer()?.annotationSelected(current.handle.id)
    } else if (Math.abs(event.clientX - current.clientX) >= 3) {
      const time = timeAt(event.clientX)
      publishSelection(time === current.start ? null : { start: Math.min(time, current.start), end: Math.max(time, current.start) })
    } else { publishSelection(null); currentPlayer()?.seek(current.start) }
  }
  // The outer viewport owns horizontal scrolling. Resizing the WaveSurfer container
  // zooms its fit-to-parent rendering without introducing a second internal scroll offset.
  function updateZoom(next: number) { setZoom(next) }

  return <section className="wn-timeline" aria-label="Recording timeline">
    <div className="wn-transport">
      <button type="button" disabled={!duration} onClick={() => playing ? pause('user') : void currentPlayer()?.play().catch(() => {})}>{playing ? 'Pause' : 'Play'}</button>
      <button type="button" disabled={!duration} onClick={() => { clearLoop(); currentPlayer()?.seek(0) }}>Restart</button>
      <output aria-label="Playback position">{formatTime(position)} / {formatTime(duration)}</output>
      <span className="wn-spacer" />
      <button type="button" disabled={!duration} aria-label="Zoom out" onClick={() => updateZoom(Math.max((zoom || viewportWidth / duration) / 1.6, 0.01))}>−</button>
      <button type="button" disabled={!duration} aria-label="Zoom in" onClick={() => updateZoom(Math.max(zoom || viewportWidth / duration, 0.01) * 1.6)}>+</button>
      <button type="button" disabled={!duration} onClick={() => updateZoom(0)}>Fit</button>
    </div>
    {error && <p className="wn-error" role="alert">Audio error: {error}</p>}
    <div className="wn-viewport" ref={viewport}>
      <div className="wn-content" ref={content} style={{ width: contentWidth }} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { if (drag.current?.kind === 'handle') { lastGestureDragged.current = true; suppressDoubleClick.current = true }; drag.current = null; setDragPreview(null) }}>
        <div className="wn-handles" style={{ height: Math.max(8, rowCount * 30) }}>
          {placements.map((place) => {
            const anchor = Math.max(0, Math.min(contentWidth, place.x))
            const center = place.left + place.width / 2
            return Math.abs(center - anchor) > 0.5 && <span key={`connector:${place.key}`} className="wn-handle-connector" style={{ left: Math.min(anchor, center), width: Math.abs(center - anchor), top: place.row * 30 + 13 }} />
          })}
          {handles.map((handle) => {
            const place = placementByKey.get(handle.key)
            if (!place) return null
            const annotation = props.annotations.find((item) => item.id === handle.id)!
            const label = `${handle.part === 'point' ? 'Point' : `Range ${handle.part}`} · ${formatTime(handle.time)} · ${noteExcerpt(annotation)}`
            return <button type="button" key={handle.key} className={`wn-handle ${props.selectedAnnotationId === handle.id ? 'is-selected' : ''}`} style={{ left: place.left, width: place.width, top: place.row * 30 }}
              aria-label={`${label} (${handle.id})`}
              title={`${label} · click to open, drag to adjust${handle.part === 'point' ? '' : ', double-click to select passage'}`}
              onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { kind: 'handle', handle, clientX: event.clientX, contentLeft: content.current?.getBoundingClientRect().left ?? 0, moved: false } }}
              onClick={(event) => { if (event.detail === 0) currentPlayer()?.annotationSelected(handle.id); else if (event.detail === 1 && !lastGestureDragged.current) suppressDoubleClick.current = false }}
              onDoubleClick={(event) => {
                event.preventDefault(); event.stopPropagation()
                const suppressed = suppressDoubleClick.current
                suppressDoubleClick.current = false
                const anchor = callbacks.current.annotations.find((item) => item.id === handle.id)?.anchor
                if (!suppressed && anchor?.kind === 'range') publishSelection({ start: anchor.start, end: anchor.end })
              }}>
              {handle.part === 'point' ? '●' : handle.part === 'start' ? '[' : ']'}
            </button>
          })}
        </div>
        <div className="wn-wave" onPointerDown={pointerDown}>
          <div ref={waveContainer} className="wn-wave-render" />
          {selection && <div className="wn-selection" style={{ left: `${selection.start / duration * 100}%`, width: `${(selection.end - selection.start) / duration * 100}%` }} />}
        </div>
      </div>
    </div>
    <div className="wn-selection-controls">
      <span>{selection ? `Selection ${formatTime(selection.start)} – ${formatTime(selection.end)}` : 'Drag the waveform to select a passage'}</span>
      <button type="button" disabled={!selection || selection.start >= selection.end} onClick={() => { if (selection && selection.start < selection.end) props.onAnnotateSelection(selection) }}>Annotate selection</button>
      <button type="button" disabled={!selection || selection.start >= selection.end} onClick={() => { if (selection) void startLoop(selection).catch(() => {}) }}>Loop selection</button>
      {loop && <button type="button" onClick={clearLoop}>Stop loop</button>}
    </div>
    {selected && <fieldset className="wn-time-fields"><legend>{noteExcerpt(selected)} · adjust time (seconds)</legend>
      {selected.anchor.kind === 'point'
        ? <TimeField label="Point" value={selected.anchor.time} duration={duration} onCommit={(time) => handleAnchor({ key: '', id: selected.id, part: 'point', time }, time)} />
        : <><TimeField label="Start" value={selected.anchor.start} duration={duration} onCommit={(time) => handleAnchor({ key: '', id: selected.id, part: 'start', time }, time)} />
          <TimeField label="End" value={selected.anchor.end} duration={duration} onCommit={(time) => handleAnchor({ key: '', id: selected.id, part: 'end', time }, time)} /></>}
    </fieldset>}
  </section>
})

function TimeField({ label, value, duration, onCommit }: { label: string; value: number; duration: number; onCommit: (time: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return <label>{label} <input type="number" min="0" max={duration} step="any" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => {
    const next = Number(draft)
    if (draft.trim() && Number.isFinite(next) && next >= 0 && next <= duration) onCommit(next)
    setDraft(String(value))
  }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
}
