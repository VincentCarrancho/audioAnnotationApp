// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import WaveSurfer from 'wavesurfer.js'
import { WaveSurferPlaybackAdapter } from './WaveSurferPlaybackAdapter'

afterEach(() => {
  document.documentElement.removeAttribute('style')
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

function captureCreate(container: HTMLElement) {
  const create = vi.spyOn(WaveSurfer, 'create').mockReturnValue({
    on: () => () => {},
  } as unknown as WaveSurfer)
  WaveSurferPlaybackAdapter.create(container)
  return create.mock.calls[0][0]
}

describe('waveform create palette', () => {
  it('resolves container and root semantic colors before creating WaveSurfer', () => {
    const root = document.documentElement
    root.style.setProperty('--color-wave', '#888888')
    root.style.setProperty('--color-wave-progress', '#555555')
    root.style.setProperty('--color-wave-cursor', '#222222')
    const container = document.createElement('div')
    container.style.setProperty('--color-wave', '#777777')
    document.body.append(container)

    expect(captureCreate(container)).toMatchObject({
      container, height: 116, waveColor: '#777777', progressColor: '#555555', cursorColor: '#222222',
      cursorWidth: 2, interact: false, autoScroll: false,
    })
  })

  it('uses individual grayscale fallbacks for missing or unresolved tokens', () => {
    const container = document.createElement('div')
    container.style.setProperty('--color-wave', 'var(--missing)')
    container.style.setProperty('--color-wave-progress', '#444444')
    document.body.append(container)

    expect(captureCreate(container)).toMatchObject({
      waveColor: '#888888', progressColor: '#444444', cursorColor: '#222222',
    })
  })

  it('falls back when DOM style access is unavailable', () => {
    const container = { ownerDocument: { defaultView: null } } as unknown as HTMLElement
    expect(captureCreate(container)).toMatchObject({
      waveColor: '#888888', progressColor: '#555555', cursorColor: '#222222',
    })
  })

  it('falls back if computed style access throws', () => {
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => { throw new Error('unavailable') })
    expect(captureCreate(document.createElement('div'))).toMatchObject({
      waveColor: '#888888', progressColor: '#555555', cursorColor: '#222222',
    })
  })
})
