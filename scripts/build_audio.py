"""Builds the winter station audio from the original downloads in raw-audio/.

Outputs (public/audio/winter/):
  ambience.m4a  seamless loop: two winds + quiet forest air + faint winter forest
  gusts.m4a     sprite of four passing gusts, played now and then at runtime
  steps.m4a     sprite of single footsteps in fresh snow
and src/audio/winterSprites.json with the sprite offsets (ms) for Howler.

Requires ffmpeg (FFMPEG env var, PATH, or the winget install location) and numpy.
Run from the project root:  python scripts/build_audio.py
"""

import json
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'raw-audio'
OUT = ROOT / 'public' / 'audio' / 'winter'
SPRITES = ROOT / 'src' / 'audio' / 'winterSprites.json'
SR = 48000


def find_ffmpeg() -> str:
    if os.environ.get('FFMPEG'):
        return os.environ['FFMPEG']
    found = shutil.which('ffmpeg')
    if found:
        return found
    winget = Path(os.environ.get('LOCALAPPDATA', '')) / 'Microsoft' / 'WinGet' / 'Packages'
    for exe in winget.glob('Gyan.FFmpeg*/*/bin/ffmpeg.exe'):
        return str(exe)
    raise SystemExit('ffmpeg not found; set FFMPEG to its path')


FFMPEG = find_ffmpeg()


def load(name: str, channels: int = 2) -> np.ndarray:
    raw = subprocess.run(
        [FFMPEG, '-v', 'error', '-i', str(RAW / name), '-ac', str(channels), '-ar', str(SR), '-f', 'f32le', '-'],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, channels).copy()


def save(x: np.ndarray, name: str, bitrate: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    channels = x.shape[1]
    subprocess.run(
        [FFMPEG, '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(channels), '-i', '-',
         '-c:a', 'aac', '-b:a', bitrate, '-movflags', '+faststart', str(OUT / name)],
        input=x.astype(np.float32).tobytes(),
        check=True,
    )


def seconds(x: np.ndarray, start: float, end: float) -> np.ndarray:
    return x[int(start * SR):int(end * SR)]


def rms_db(x: np.ndarray) -> float:
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)


def gain_to(x: np.ndarray, target_db: float) -> np.ndarray:
    return x * 10 ** ((target_db - rms_db(x)) / 20)


def fade(x: np.ndarray, fade_in: float, fade_out: float) -> np.ndarray:
    x = x.copy()
    n_in, n_out = int(fade_in * SR), int(fade_out * SR)
    if n_in:
        x[:n_in] *= np.sin(np.linspace(0, np.pi / 2, n_in))[:, None]  # equal-power
    if n_out:
        x[-n_out:] *= np.cos(np.linspace(0, np.pi / 2, n_out))[:, None]
    return x


def crossfade_tile(x: np.ndarray, length: float, overlap: float) -> np.ndarray:
    """Repeats a short clip with crossfades until it is at least `length` seconds long."""
    n_ov = int(overlap * SR)
    out = x.copy()
    while len(out) < length * SR:
        a, b = out[:-n_ov], out[-n_ov:]
        t = np.linspace(0, np.pi / 2, n_ov)[:, None]
        out = np.concatenate([a, b * np.cos(t) + x[:n_ov] * np.sin(t), x[n_ov:]])
    return out


def seamless_loop(x: np.ndarray, loop_len: float, overlap: float) -> np.ndarray:
    """Takes loop_len + overlap seconds and folds the tail into the head so the end flows into the start."""
    n, n_ov = int(loop_len * SR), int(overlap * SR)
    x = x[:n + n_ov]
    t = np.linspace(0, np.pi / 2, n_ov)[:, None]
    head = x[:n_ov] * np.sin(t) + x[n:n + n_ov] * np.cos(t)
    return np.concatenate([head, x[n_ov:n]])


def limit_peak(x: np.ndarray, peak_db: float) -> np.ndarray:
    peak = np.max(np.abs(x))
    ceiling = 10 ** (peak_db / 20)
    return x * (ceiling / peak) if peak > ceiling else x


def sprite(clips: list[np.ndarray], gap: float, prefix: str) -> tuple[np.ndarray, dict]:
    parts, offsets, cursor = [], {}, 0
    silence = np.zeros((int(gap * SR), clips[0].shape[1]), dtype=np.float32)
    for i, c in enumerate(clips):
        offsets[f'{prefix}{i}'] = [round(cursor / SR * 1000), round(len(c) / SR * 1000)]
        parts += [c, silence]
        cursor += len(c) + len(silence)
    return np.concatenate(parts), offsets


def build_ambience() -> None:
    loop_len, overlap = 36.0, 4.0
    total = loop_len + overlap
    # Layer levels (RMS dBFS before the final trim): gentle wind leads, the rest sits underneath.
    wind_plain = gain_to(seconds(load('697217__dhallcomposer__looping-gentle-wind-ambience-on-an-open-desert-plain.wav'), 0, total), -30)
    wind_trees = gain_to(seconds(load('662575__alppdcjr12__wind-in-trees-1.mp3'), 3, 3 + total), -34)
    quiet_air = gain_to(seconds(crossfade_tile(load('348829__yoyodaman234__very-quiet-forest-ambience.wav'), total, 4), 0, total), -39)
    forest = gain_to(seconds(load('260634__lwdickens__outdoor-winter-ambience-birds-light-wind-trees.wav'), 40, 40 + total), -41)
    n = min(len(wind_plain), len(wind_trees), len(quiet_air), len(forest))
    mix = wind_plain[:n] + wind_trees[:n] + quiet_air[:n] + forest[:n]
    loop = limit_peak(gain_to(seamless_loop(mix, loop_len, overlap), -26), -3)
    save(loop, 'ambience.m4a', '80k')
    print(f'ambience: {len(loop) / SR:.1f}s, {rms_db(loop):.1f} dB RMS')


def build_gusts() -> dict:
    src = load('405601__dblover__howling-wind-ambience.mp3')
    windows = [(4, 12.5), (17, 25.5), (44, 53), (65.5, 74.5)]  # around the loudest moments
    clips = [limit_peak(gain_to(fade(seconds(src, a, b), 2.5, 3.5), -24), -4) for a, b in windows]
    data, offsets = sprite(clips, 0.5, 'gust')
    save(data, 'gusts.m4a', '64k')
    print(f'gusts: {len(clips)} clips, {len(data) / SR:.1f}s')
    return offsets


def build_steps() -> dict:
    src = load('453168__florianreichelt__footsteps-in-fresh-snow.wav', channels=1)
    onsets = [2.01, 5.01, 6.07, 7.17, 9.26, 10.33, 11.43, 13.51]  # clean single steps
    clips = []
    for t in onsets:
        c = fade(seconds(src, t - 0.02, t + 0.55), 0.005, 0.2)
        peak = np.max(np.abs(c))
        clips.append(c * (10 ** (-6 / 20) / peak))  # even out step loudness
    data, offsets = sprite(clips, 0.3, 'step')
    save(data, 'steps.m4a', '96k')
    print(f'steps: {len(clips)} clips, {len(data) / SR:.1f}s')
    return offsets


if __name__ == '__main__':
    build_ambience()
    sprites = {'gusts': build_gusts(), 'steps': build_steps()}
    SPRITES.parent.mkdir(parents=True, exist_ok=True)
    SPRITES.write_text(json.dumps(sprites, indent=2) + '\n', encoding='utf-8')
    for f in sorted(OUT.iterdir()):
        print(f'{f.name}: {f.stat().st_size / 1024:.0f} KB')
