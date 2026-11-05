import { describe, expect, it } from 'vitest'
import { isValidAnchor } from './project'

describe('recording-bound annotation anchors', () => {
  it('accepts points at either boundary and a positive-length range', () => {
    expect(isValidAnchor({ kind: 'point', time: 0 }, 10)).toBe(true)
    expect(isValidAnchor({ kind: 'point', time: 10 }, 10)).toBe(true)
    expect(isValidAnchor({ kind: 'range', start: 0, end: 10 }, 10)).toBe(true)
  })

  it('rejects invalid durations, non-finite times, out-of-bounds and empty ranges', () => {
    expect(isValidAnchor({ kind: 'point', time: 0 }, Number.NaN)).toBe(false)
    expect(isValidAnchor({ kind: 'point', time: Infinity }, 10)).toBe(false)
    expect(isValidAnchor({ kind: 'point', time: -1 }, 10)).toBe(false)
    expect(isValidAnchor({ kind: 'range', start: 1, end: 11 }, 10)).toBe(false)
    expect(isValidAnchor({ kind: 'range', start: 2, end: 2 }, 10)).toBe(false)
    expect(isValidAnchor({ kind: 'range', start: 3, end: 2 }, 10)).toBe(false)
  })
})
