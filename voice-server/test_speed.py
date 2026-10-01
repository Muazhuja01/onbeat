import io
import os
import shutil

import numpy as np
import pytest
import soundfile as sf

from speed import change_speed, rubberband_args, to_wav_bytes


def test_rubberband_args_use_the_r3_engine_and_keep_pitch():
    assert rubberband_args(0.85, "in.wav", "out.wav")[1:] == ["--quiet", "--fine", "--tempo", "0.85", "in.wav", "out.wav"]


def test_normal_speed_is_untouched():
    x = np.linspace(-0.5, 0.5, 2400, dtype=np.float32)
    assert change_speed(x, 24000, 1.0) is x


def test_wav_bytes_are_16_bit_mono():
    data, sr = sf.read(io.BytesIO(to_wav_bytes(np.zeros(2400, dtype=np.float32), 24000)))
    info = sf.info(io.BytesIO(to_wav_bytes(np.zeros(2400, dtype=np.float32), 24000)))
    assert (sr, len(data), info.channels, info.subtype) == (24000, 2400, 1, "PCM_16")


@pytest.mark.skipif(not shutil.which(os.environ.get("RUBBERBAND", "rubberband")), reason="Rubber Band not installed")
def test_slower_is_longer_and_faster_is_shorter():
    t = np.arange(24000) / 24000
    tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    assert abs(len(change_speed(tone, 24000, 0.85)) - 24000 / 0.85) < 600
    assert abs(len(change_speed(tone, 24000, 1.15)) - 24000 / 1.15) < 600
