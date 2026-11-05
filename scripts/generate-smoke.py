"""Generate the same two-second, low-volume mono PCM WAV for browser and Tauri smoke tests."""
import math
import pathlib
import struct
import wave

root = pathlib.Path(__file__).resolve().parent.parent
sample_rate = 44100
samples = b''.join(
    struct.pack('<h', round(32767 * 0.12 * math.sin(2 * math.pi * 440 * n / sample_rate)))
    for n in range(sample_rate * 2)
)
for path in (root / 'public/smoke.wav', root / 'src-tauri/resources/smoke.wav'):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(samples)
