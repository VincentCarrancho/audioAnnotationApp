/** Each handle has a centered footprint in waveform-content coordinates. Handles
 * with the same group are placed together, but do not reserve the span between. */
export interface HandleFootprint { key: string; x: number; width: number; group?: string }
export interface HandlePlacement extends HandleFootprint { left: number; row: number }

/** Stable screen-space packing. Range pairs stay reachable even at the edges. */
export function placeHandles(handles: HandleFootprint[], contentWidth: number, gap = 4): HandlePlacement[] {
  const width = Math.max(0, contentWidth)
  const groups: Array<{ index: number; handles: Array<HandleFootprint & { left: number }> }> = []
  const grouped = new Map<string, typeof groups[number]>()
  handles.forEach((handle, index) => {
    let group = handle.group === undefined ? undefined : grouped.get(handle.group)
    if (!group) {
      group = { index, handles: [] }
      groups.push(group)
      if (handle.group !== undefined) grouped.set(handle.group, group)
    }
    group.handles.push({ ...handle, left: 0 })
  })
  for (const group of groups) {
    const pair = group.handles.length === 2
    for (const handle of group.handles) {
      handle.width = Math.min(handle.width, pair ? width / 2 : width)
      handle.left = Math.max(0, Math.min(width - handle.width, handle.x - handle.width / 2))
    }
    if (pair) {
      const [first, second] = [...group.handles].sort((a, b) => a.x - b.x)
      if (first.left + first.width > second.left) {
        // Project onto adjacent, non-overlapping footprints with minimum movement.
        const firstLeft = (first.left + second.left - first.width) / 2
        first.left = Math.max(0, Math.min(width - first.width - second.width, firstLeft))
        second.left = first.left + first.width
      }
    }
  }
  groups.sort((a, b) => Math.min(...a.handles.map((h) => h.left)) - Math.min(...b.handles.map((h) => h.left)) || a.index - b.index)
  const rows: Array<Array<{ left: number; right: number }>> = []
  const result: HandlePlacement[] = []
  for (const group of groups) {
    let row = rows.findIndex((occupied) => group.handles.every((handle) => occupied.every((other) =>
      handle.left >= other.right + gap || handle.left + handle.width + gap <= other.left)))
    if (row < 0) { row = rows.length; rows.push([]) }
    for (const handle of group.handles) {
      rows[row].push({ left: handle.left, right: handle.left + handle.width })
      result.push({ ...handle, row })
    }
  }
  return result
}
