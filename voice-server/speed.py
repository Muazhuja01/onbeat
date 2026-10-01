"""Speed changes that keep the pitch (Rubber Band's R3 engine; WSOLA warbled on slowed Turbo voices), and WAV output."""
import io
import os
import subprocess
import tempfile

import numpy as np
import soundfile as sf

RUBBERBAND = os.environ.get("RUBBERBAND", "rubberband")


def rubberband_args(speed: float, src: str, dst: str) -> list[str]:
    return [RUBBERBAND, "--quiet", "--fine", "--tempo", f"{speed:g}", src, dst]


def change_speed(samples: np.ndarray, sr: int, speed: float) -> np.ndarray:
    if speed == 1.0:
        return samples
    with tempfile.TemporaryDirectory() as d:
        src, dst = os.path.join(d, "in.wav"), os.path.join(d, "out.wav")
        sf.write(src, samples, sr, subtype="FLOAT")
        subprocess.run(rubberband_args(speed, src, dst), check=True, capture_output=True)
        out, _ = sf.read(dst, dtype="float32")
    return out if out.ndim == 1 else out.mean(axis=1)


def to_wav_bytes(samples: np.ndarray, sr: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.clip(samples, -1.0, 1.0), sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()
