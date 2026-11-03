"""Prints an energy envelope or detected footstep onsets for an audio file (decoded via ffmpeg).

Usage: python scripts/analyze_audio.py <ffmpeg> <file> steps|seconds
  steps    list loud events (single footsteps) with start/end times
  seconds  RMS loudness per second (find gusts, quiet parts)
"""
import subprocess, sys
import numpy as np

ffmpeg, path, mode = sys.argv[1], sys.argv[2], sys.argv[3]
sr = 22050
raw = subprocess.run([ffmpeg, '-v', 'error', '-i', path, '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'],
                     capture_output=True, check=True).stdout
x = np.frombuffer(raw, dtype=np.float32)
print(f'duration {len(x)/sr:.2f}s')

if mode == 'steps':
    hop = int(sr * 0.01)
    n = len(x) // hop
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    floor = np.percentile(db, 20)
    peak = np.percentile(db, 99)
    thr = floor + (peak - floor) * 0.45
    print(f'floor {floor:.1f} dB, peak {peak:.1f} dB, threshold {thr:.1f} dB')
    on = None
    events = []
    for i, v in enumerate(db):
        if on is None and v > thr:
            on = i
        elif on is not None and v < thr - 6:
            events.append((on, i))
            on = None
    for a, b in events:
        if (b - a) * 0.01 >= 0.08:
            seg = db[a:b]
            print(f'step {a*0.01:6.2f} - {b*0.01:6.2f}  ({(b-a)*10:4d} ms)  peak {seg.max():.1f} dB')
else:
    hop = sr
    n = len(x) // hop
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    print(' '.join(f'{i}:{v:.0f}' for i, v in enumerate(db)))
