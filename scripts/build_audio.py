"""Builds the station audio from the original downloads in raw-audio/.

Outputs, public/audio/winter/:
  ambience.m4a  seamless loop: two winds + quiet forest air + faint winter forest
  gusts.m4a     sprite of four passing gusts, played now and then at runtime
  steps.m4a     sprite of single footsteps in fresh snow
  wood.m4a      sprite of single footsteps on the wooden platform
public/audio/spring/:
  ambience.m4a  seamless loop: a dawn bird chorus
  creek.m4a     seamless loop: the stream, louder the closer you are
  rain.m4a      sprite of four short spells of soft raindrops, played now and then
  grass.m4a     sprite of single footsteps on grass
  zipwind.m4a   seamless loop: wind past the ears on the zipline (level follows speed at runtime)
and src/audio/sprites.json with the sprite offsets (ms) for Howler.

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
OUT = ROOT / 'public' / 'audio'
SPRITES = ROOT / 'src' / 'audio' / 'sprites.json'
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
    """name is relative to public/audio, e.g. 'winter/steps.m4a'."""
    (OUT / name).parent.mkdir(parents=True, exist_ok=True)
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
    save(loop, 'winter/ambience.m4a', '80k')
    print(f'winter ambience: {len(loop) / SR:.1f}s, {rms_db(loop):.1f} dB RMS')


def build_gusts() -> dict:
    src = load('405601__dblover__howling-wind-ambience.mp3')
    windows = [(4, 12.5), (17, 25.5), (44, 53), (65.5, 74.5)]  # around the loudest moments
    clips = [limit_peak(gain_to(fade(seconds(src, a, b), 2.5, 3.5), -24), -4) for a, b in windows]
    data, offsets = sprite(clips, 0.5, 'gust')
    save(data, 'winter/gusts.m4a', '64k')
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
    save(data, 'winter/steps.m4a', '96k')
    print(f'steps: {len(clips)} clips, {len(data) / SR:.1f}s')
    return offsets


def build_wood_steps() -> dict:
    src = load('521589__fission9__hiking-boot-footsteps-on-wooden-planks.wav', channels=1)
    onsets = [0.10, 0.53, 0.93, 1.40, 1.82, 2.26]  # six clean steps, ~0.43 s apart
    clips = []
    for t in onsets:
        c = fade(seconds(src, t - 0.01, t + 0.32), 0.003, 0.12)
        peak = np.max(np.abs(c))
        clips.append(c * (10 ** (-6 / 20) / peak))
    data, offsets = sprite(clips, 0.3, 'wood')
    save(data, 'winter/wood.m4a', '96k')
    print(f'wood steps: {len(clips)} clips, {len(data) / SR:.1f}s')
    return offsets


def build_spring_ambience() -> None:
    # Birds only; the creek is its own loop so it can sound louder near the stream.
    loop_len, overlap = 72.0, 4.0
    birds = load('578523__samsterbirdies__birds-singing-dawn-chorus.flac')
    loop = limit_peak(gain_to(seamless_loop(seconds(birds, 20, 20 + loop_len + overlap), loop_len, overlap), -26), -3)
    save(loop, 'spring/ambience.m4a', '80k')
    print(f'spring ambience: {len(loop) / SR:.1f}s, {rms_db(loop):.1f} dB RMS')


def build_creek() -> None:
    # The original is already a seamless 36 s loop; only the level changes.
    creek = limit_peak(gain_to(load('231536__vkproduktion__creek-06-loop.wav'), -26), -3)
    save(creek, 'spring/creek.m4a', '80k')
    print(f'creek: {len(creek) / SR:.1f}s')


def build_rain() -> dict:
    src = load('664162__brunoauzet__soft-rain-drops.wav')
    windows = [(22, 35), (52, 68), (126, 140), (143, 160)]  # the denser spells of drops
    clips = [limit_peak(gain_to(fade(seconds(src, a, b), 3, 4), -30), -6) for a, b in windows]
    data, offsets = sprite(clips, 0.5, 'rain')
    save(data, 'spring/rain.m4a', '64k')
    print(f'rain: {len(clips)} clips, {len(data) / SR:.1f}s')
    return offsets


def compress(x: np.ndarray, threshold_db: float, ratio: float, window: float = 0.08) -> np.ndarray:
    """Gentle compressor: turns down the loud gusts so the whole sound can sit higher."""
    n = int(window * SR)
    power = np.convolve(np.mean(x ** 2, axis=1), np.ones(n) / n, mode='same')
    level_db = 10 * np.log10(power + 1e-12)
    over = np.maximum(0, level_db - threshold_db)
    gain = 10 ** (-over * (1 - 1 / ratio) / 20)
    return x * gain[:, None]


def soft_limit(x: np.ndarray, ceiling_db: float) -> np.ndarray:
    """Rounds off brief peaks toward the ceiling instead of turning the whole sound down (fine on noise)."""
    c = 10 ** (ceiling_db / 20)
    return c * np.tanh(x / c)


def build_zip_wind() -> None:
    # Even foley wind; a 24 s seamless loop is plenty for a 9 s ride.
    loop_len, overlap = 24.0, 4.0
    wind = load('393007__josecruz98__sonido-viento-fondo.wav')
    wind = compress(seconds(wind, 1, 1 + loop_len + overlap), -38, 3)
    loop = soft_limit(gain_to(seamless_loop(wind, loop_len, overlap), -17), -4)
    save(loop, 'spring/zipwind.m4a', '64k')
    print(f'zip wind: {len(loop) / SR:.1f}s')


def remove_click(x: np.ndarray, start: float, end: float) -> np.ndarray:
    """Finds the sharpest jump between start and end (s) and bridges 3 ms around it with a straight line."""
    x = x.copy()
    a, b = int(start * SR), int(end * SR)
    k = a + int(np.argmax(np.abs(np.diff(x[a:b, 0]))))
    h = int(0.0015 * SR)
    lo, hi = k - h, k + h
    x[lo:hi] = np.linspace(x[lo], x[hi], hi - lo, endpoint=False)
    return x


def build_grass_steps() -> dict:
    files = {  # file: onset of the step (s)
        '151230__owlstorm__grassy-footstep-1.wav': 0.08,
        '151229__owlstorm__grassy-footstep-2.wav': 0.04,
        '151228__owlstorm__grassy-footstep-3.wav': 0.08,
        '151235__owlstorm__grassy-footstep-4.wav': 0.09,
    }
    clips = []
    for name, t in files.items():
        src = load(name, channels=1)
        if 'footstep-2' in name:
            src = remove_click(src, 0.185, 0.205)  # a small tick inside the step
        c = fade(seconds(src, t - 0.02, t + 0.34), 0.004, 0.12)
        peak = np.max(np.abs(c))
        clips.append(c * (10 ** (-6 / 20) / peak))
    data, offsets = sprite(clips, 0.3, 'grass')
    save(data, 'spring/grass.m4a', '96k')
    print(f'grass steps: {len(clips)} clips, {len(data) / SR:.1f}s')
    return offsets


if __name__ == '__main__':
    build_ambience()
    build_spring_ambience()
    build_creek()
    build_zip_wind()
    sprites = {
        'gusts': build_gusts(),
        'steps': build_steps(),
        'wood': build_wood_steps(),
        'rain': build_rain(),
        'grass': build_grass_steps(),
    }
    SPRITES.parent.mkdir(parents=True, exist_ok=True)
    SPRITES.write_text(json.dumps(sprites, indent=2) + '\n', encoding='utf-8')
    for f in sorted(OUT.rglob('*.m4a')):
        print(f'{f.relative_to(OUT)}: {f.stat().st_size / 1024:.0f} KB')
