import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  handler: undefined as undefined | ((event: { preventDefault: () => void }) => void),
  destroy: vi.fn(),
  unlisten: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: typeof native.handler) => { native.handler = handler; return native.unlisten },
    destroy: native.destroy,
  }),
}))

import { protectNativeClose } from './index'

function requestClose() {
  const preventDefault = vi.fn()
  if (!native.handler) throw new Error('Close listener not installed')
  native.handler({ preventDefault })
  expect(preventDefault).toHaveBeenCalledOnce()
}

describe('protectNativeClose', () => {
  beforeEach(() => {
    native.handler = undefined
    native.destroy.mockReset().mockResolvedValue(undefined)
    native.unlisten.mockReset()
  })

  it('cancels without destroying, then allows a subsequent close', async () => {
    const allow = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const onError = vi.fn()
    const stop = await protectNativeClose(allow, onError)
    requestClose()
    await vi.waitFor(() => expect(allow).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(native.destroy).not.toHaveBeenCalled()
    requestClose()
    await vi.waitFor(() => expect(native.destroy).toHaveBeenCalledOnce())
    expect(allow).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
    stop()
    expect(native.unlisten).toHaveBeenCalledOnce()
  })

  it('coalesces repeated requests while the async flush is pending', async () => {
    let resolve!: (value: boolean) => void
    const allow = vi.fn(() => new Promise<boolean>(done => { resolve = done }))
    await protectNativeClose(allow, vi.fn())
    requestClose()
    requestClose()
    expect(allow).toHaveBeenCalledOnce()
    expect(native.destroy).not.toHaveBeenCalled()
    resolve(true)
    await vi.waitFor(() => expect(native.destroy).toHaveBeenCalledOnce())
  })

  it('keeps the window open and reports flush or destroy errors', async () => {
    const allow = vi.fn().mockRejectedValueOnce(new Error('flush failed')).mockResolvedValueOnce(true)
    const onError = vi.fn()
    native.destroy.mockRejectedValueOnce(new Error('destroy failed'))
    await protectNativeClose(allow, onError)
    requestClose()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'flush failed' })))
    expect(native.destroy).not.toHaveBeenCalled()
    requestClose()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'destroy failed' })))
  })
})
