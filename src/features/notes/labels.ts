import type { Annotation, AnnotationAnchor, NoteDocument } from '../../contracts'

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor(whole / 60) % 60
  const rest = String(whole % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

export function formatAnchor(anchor: AnnotationAnchor): string {
  return anchor.kind === 'point' ? formatTime(anchor.time) : `${formatTime(anchor.start)} – ${formatTime(anchor.end)}`
}

function plain(html: string): string {
  // Parse as inert HTML and render the result as React text, never as markup.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function listText(items: unknown): string {
  if (!Array.isArray(items)) return ''
  for (const item of items) {
    if (typeof item === 'string') {
      const text = plain(item)
      if (text) return text
    } else if (item && typeof item === 'object') {
      const value = item as { content?: unknown; items?: unknown }
      if (typeof value.content === 'string') {
        const text = plain(value.content)
        if (text) return text
      }
      const nested = listText(value.items)
      if (nested) return nested
    }
  }
  return ''
}

export function noteExcerpt(document: NoteDocument): string {
  for (const block of document.blocks) {
    const data = block.data as { text?: unknown; items?: unknown } | undefined
    const text = typeof data?.text === 'string' ? plain(data.text) : listText(data?.items)
    if (text) return text
  }
  return ''
}

export function annotationLabel(annotation: Annotation, pending: boolean): string {
  const excerpt = noteExcerpt(annotation.note)
  if (!excerpt) return pending ? 'Pending annotation' : 'Empty annotation'
  return excerpt.length > 160 ? `${excerpt.slice(0, 157).trimEnd()}…` : excerpt
}
