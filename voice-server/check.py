"""Checks the deployed voice server: every voice at every speed, timing, the cost so far, and optionally a Whisper pass.

    python voice-server/check.py [--out DIR] [--whisper]

Run it after the server has been idle for 6 minutes to also measure a cold start (the first line)."""
import argparse
import io
import os
import re
import subprocess
import sys
import time

import modal

sys.path.insert(0, os.path.dirname(__file__))
from voices import SPEEDS, VOICES  # noqa: E402

LINE = "Physio moved to Thursdays at eleven, so I'll see you then."


def words(s: str) -> list[str]:
    return re.sub(r"[^a-z' ]", " ", s.lower().replace("11", "eleven")).split()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="C:/Users/hujai/Music/chatterbox-test/deployed")
    p.add_argument("--whisper", action="store_true")
    args = p.parse_args()
    os.makedirs(args.out, exist_ok=True)
    voice = modal.Cls.from_name("onbeat-voice", "Voice")()
    asr = None
    if args.whisper:
        from transformers import pipeline

        asr = pipeline("automatic-speech-recognition", model="openai/whisper-small.en", device="cpu")
    first = True
    for voice_id in VOICES:
        for speed in SPEEDS:
            t = time.time()
            wav = voice.make.remote(LINE, voice_id, speed)
            took = time.time() - t
            label = "cold start" if first else "line"
            first = False
            path = f"{args.out}/{voice_id}-{speed:g}.wav"
            with open(path, "wb") as f:
                f.write(wav)
            note = ""
            if asr:
                import librosa

                y, _ = librosa.load(io.BytesIO(wav), sr=16000)
                heard = asr({"raw": y, "sampling_rate": 16000})["text"]
                missing = len(set(words(LINE)) - set(words(heard)))
                note = f" | heard: {heard.strip()}" + (" | CHECK" if missing > 1 else "")
            print(f"{voice_id:12} {speed:<5g} {label}: {took:.2f} s{note}", flush=True)
    print(subprocess.run([sys.executable, "-m", "modal", "billing", "summary"], capture_output=True, text=True, env={**os.environ, "PYTHONUTF8": "1"}).stdout)


if __name__ == "__main__":
    main()
