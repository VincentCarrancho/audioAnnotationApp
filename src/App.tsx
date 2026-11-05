import { useEffect, useRef, useState } from 'react'
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core'
import { resolveResource } from '@tauri-apps/api/path'
import WaveSurfer from 'wavesurfer.js'

function reportSmoke(status: string) {
  if (isTauri()) void invoke('report_smoke', { status }).catch(console.error)
}

export default function App() {
  const container = useRef<HTMLDivElement>(null)
  const player = useRef<WaveSurfer | null>(null)
  const [status, setStatus] = useState('Loading fixture…')
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!container.current) return
    let disposed = false
    const wave = WaveSurfer.create({ container: container.current, height: 100, waveColor: '#536b85', progressColor: '#b9e4d4' })
    player.current = wave
    wave.on('ready', (duration) => {
      setStatus(`Ready: ${duration.toFixed(2)} seconds`)
      reportSmoke(`ready duration=${duration.toFixed(2)}`)
    })
    wave.on('play', () => { setPlaying(true); reportSmoke('playing') })
    wave.on('pause', () => setPlaying(false))
    wave.on('finish', () => { setPlaying(false); reportSmoke('finished') })
    wave.on('error', (error) => { setStatus(`Audio error: ${error.message}`); reportSmoke(`error ${error.message}`) })

    async function load() {
      try {
        const url = isTauri() ? convertFileSrc(await resolveResource('resources/smoke.wav')) : '/smoke.wav'
        if (!disposed) await wave.load(url)
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : String(error)
          setStatus(`Audio error: ${message}`)
          reportSmoke(`error ${message}`)
        }
      }
    }
    void load()
    return () => { disposed = true; wave.destroy(); player.current = null }
  }, [])

  return (
    <main>
      <p className="eyebrow">wavNotes · foundation</p>
      <h1>Listening notebook</h1>
      <p>This is the foundation shell, not the finished project workflow.</p>
      <section aria-labelledby="smoke-title">
        <h2 id="smoke-title">Local WAV playback check</h2>
        <p>A bundled two-second PCM test tone validates the WaveSurfer audio path.</p>
        <div ref={container} aria-label="Test waveform" />
        <p role="status">{status}</p>
        <button type="button" onClick={() => { void player.current?.playPause().catch((error: Error) => { setStatus(`Audio error: ${error.message}`); reportSmoke(`error ${error.message}`) }) }}>
          {playing ? 'Pause fixture' : 'Play fixture'}
        </button>
      </section>
    </main>
  )
}
