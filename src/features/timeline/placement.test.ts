import { describe, expect, it } from 'vitest'
import { placeHandles } from './placement'

describe('screen-space handle placement', () => {
  it('stacks exact overlaps and releases nearby handles with zoom', () => {
    const crowded = placeHandles([{ key: 'a', x: 40, width: 30 }, { key: 'b', x: 40, width: 30 }, { key: 'c', x: 60, width: 30 }], 200)
    expect(crowded.map((h) => h.row)).toEqual([0, 1, 2])
    const zoomed = placeHandles([{ key: 'a', x: 80, width: 30 }, { key: 'b', x: 80, width: 30 }, { key: 'c', x: 120, width: 30 }], 400)
    expect(zoomed.map((h) => h.row)).toEqual([0, 1, 0])
  })
  it('clamps recording-end handles into the scrollable area, while keeping them separate', () => {
    const result = placeHandles([{ key: 'first', x: 0, width: 34 }, { key: 'last', x: 100, width: 34 }, { key: 'last2', x: 100, width: 34 }], 100)
    expect(result.map((h) => [h.left, h.row])).toEqual([[0, 0], [66, 0], [66, 1]])
  })
})
