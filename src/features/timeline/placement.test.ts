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
  it('places both endpoints together without reserving the passage between them, and un-stacks on zoom', () => {
    const handles = (scale: number) => [
      { key: 'a:start', group: 'a', x: 20 * scale, width: 34 },
      { key: 'a:end', group: 'a', x: 180 * scale, width: 34 },
      { key: 'b:start', group: 'b', x: 25 * scale, width: 34 },
      { key: 'b:end', group: 'b', x: 140 * scale, width: 34 },
      { key: 'point', x: 80 * scale, width: 34 },
    ]
    const crowded = placeHandles(handles(1), 200)
    const row = (key: string) => crowded.find((h) => h.key === key)!.row
    expect([row('a:start'), row('a:end'), row('b:start'), row('b:end'), row('point')]).toEqual([0, 0, 1, 1, 0])
    const zoomed = placeHandles(handles(10), 2000)
    expect(zoomed.every((h) => h.row === 0)).toBe(true)
  })
  it('keeps duplicate, narrow and edge-clamped pairs reachable on the same row', () => {
    const items = [
      { key: 'a:start', group: 'a', x: 0, width: 34 }, { key: 'a:end', group: 'a', x: 1, width: 34 },
      { key: 'b:start', group: 'b', x: 0, width: 34 }, { key: 'b:end', group: 'b', x: 1, width: 34 },
      { key: 'c:start', group: 'c', x: 99, width: 34 }, { key: 'c:end', group: 'c', x: 100, width: 34 },
      { key: 'point', x: 0, width: 34 },
    ]
    const result = placeHandles(items, 100)
    const get = (key: string) => result.find((h) => h.key === key)!
    for (const id of ['a', 'b', 'c']) {
      const start = get(`${id}:start`), end = get(`${id}:end`)
      expect(start.row).toBe(end.row)
      expect(start.left + start.width).toBeLessThanOrEqual(end.left)
      expect(start.left).toBeGreaterThanOrEqual(0)
      expect(end.left + end.width).toBeLessThanOrEqual(100)
    }
    expect(get('a:start').row).not.toBe(get('b:start').row)
    expect(get('point').row).not.toBe(get('a:start').row)
    const tiny = placeHandles(items.slice(0, 2), 40)
    expect(tiny[0].left + tiny[0].width).toBeLessThanOrEqual(tiny[1].left)
    expect(tiny[1].left + tiny[1].width).toBeLessThanOrEqual(40)
  })
})
