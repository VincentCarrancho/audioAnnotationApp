/** Each handle has a centered footprint in waveform-content coordinates. */
export interface HandleFootprint { key: string; x: number; width: number }
export interface HandlePlacement extends HandleFootprint { left: number; row: number }

/** Stable greedy interval packing, with bounds clamped so endpoint handles remain reachable. */
export function placeHandles(handles: HandleFootprint[], contentWidth: number, gap = 4): HandlePlacement[] {
  const width = Math.max(0, contentWidth)
  const rows: number[] = []
  return handles.map((handle, index) => ({ ...handle, index,
    left: Math.max(0, Math.min(Math.max(0, width - handle.width), handle.x - handle.width / 2)),
  })).sort((a, b) => a.left - b.left || a.index - b.index).map((handle) => {
    let row = rows.findIndex((right) => handle.left >= right + gap)
    if (row < 0) row = rows.length
    rows[row] = handle.left + handle.width
    return { key: handle.key, x: handle.x, width: handle.width, left: handle.left, row }
  })
}
