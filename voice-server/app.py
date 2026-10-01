"""OnBeat's voice server on Modal: Chatterbox Nano and Turbo on a T4, all 13 voices ready in a GPU memory snapshot.

Deploy from the repo root (Windows needs PYTHONUTF8=1):
    python -m modal deploy voice-server/app.py
"""
import pathlib
import sys
import time

import modal

CHATTERBOX = "chatterbox-tts @ git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2"
HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))  # so add_local_python_source finds voices.py and speed.py when deploying from the repo root


def download_models():
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    for nano in (True, False):
        ChatterboxTurboTTS.from_pretrained(device="cpu", nano=nano)


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "rubberband-cli")
    .pip_install(CHATTERBOX, "soundfile", "fastapi[standard]")
    .run_function(download_models)
    .add_local_dir(HERE / "refs", "/refs", ignore=lambda p: not str(p).endswith(".wav"))
    .add_local_python_source("voices", "speed")
)
app = modal.App("onbeat-voice", image=image)


@app.cls(
    gpu="T4",
    max_containers=2,
    scaledown_window=300,
    timeout=600,
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
)
class Voice:
    @modal.enter(snap=True)
    def load(self):
        import numpy as np
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        from voices import VOICES

        started = time.time()
        self.models, self.conds = {}, {}
        for name in ("nano", "turbo"):
            m = ChatterboxTurboTTS.from_pretrained(device="cuda", nano=name == "nano")
            norm = m.norm_loudness  # returns float64, which breaks the tokenizer's float32 mel filters
            m.norm_loudness = lambda w, sr, norm=norm: norm(w, sr).astype(np.float32)
            builtin = m.conds
            for voice_id, (model, ref) in VOICES.items():
                if model != name:
                    continue
                if ref:
                    m.prepare_conditionals(f"/refs/{ref}.wav")
                self.conds[voice_id] = m.conds if ref else builtin
            m.conds = builtin
            m.generate("Warming up.")
            self.models[name] = m
        print(f"voices ready in {time.time() - started:.1f} s")

    def _make(self, text: str, voice: str, speed: float) -> bytes:
        import torch

        from speed import change_speed, to_wav_bytes
        from voices import VOICES

        m = self.models[VOICES[voice][0]]
        # Swapping the shared model's voice is safe only because a container takes one input at a
        # time. Don't add @modal.concurrent without a lock around this and generate().
        m.conds = self.conds[voice]
        wav = m.generate(text)
        torch.cuda.synchronize()
        samples = wav.squeeze(0).cpu().numpy()
        return to_wav_bytes(change_speed(samples, m.sr, speed), m.sr)

    @modal.method()
    def make(self, text: str, voice: str, speed: float) -> bytes:
        from voices import check_request

        return self._make(*check_request({"text": text, "voice": voice, "speed": speed}))

    @modal.asgi_app(requires_proxy_auth=True)
    def web(self):
        from fastapi import FastAPI, HTTPException, Response

        from voices import check_request

        api = FastAPI()

        @api.post("/warm")
        def warm():
            # The models load before the first request is served, so answering means ready.
            return Response(status_code=204)

        @api.post("/speak")
        def speak(body: dict):
            try:
                text, voice, speed = check_request(body)
            except ValueError as err:
                raise HTTPException(status_code=400, detail=str(err)) from err
            return Response(self._make(text, voice, speed), media_type="audio/wav")

        return api
