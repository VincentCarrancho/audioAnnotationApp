// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { annotationLabel, formatAnchor, noteExcerpt } from './labels'

describe('annotation labels', () => {
  it('derives safe plain text from nested formatted list items and skips empty blocks', () => {
    expect(noteExcerpt({ blocks: [
      { type: 'paragraph', data: { text: '<br>' } },
      { type: 'list', data: { items: [{ content: '', items: [{ content: '<a href="https://example.com">A &amp; <b>B</b></a>', items: [] }] }] } },
    ] })).toBe('A & B')
    expect(annotationLabel({ id: 'a', anchor: { kind: 'point', time: 0 }, note: { blocks: [] } }, true)).toBe('Pending annotation')
    expect(formatAnchor({ kind: 'range', start: 62, end: 3661 })).toBe('1:02 – 1:01:01')
  })
})
