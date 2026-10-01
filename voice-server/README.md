# OnBeat voice server

Chatterbox (https://github.com/resemble-ai/chatterbox, MIT) on a Modal T4 GPU. The app's `/api/speak` route calls it with a Modal proxy token; nothing else can.

- `voices.py`: the 13 voices (ids match `src/lib/voice/choices.ts`).
- `speed.py`: Slower and Faster with Rubber Band's R3 engine, so the pitch stays.
- `app.py`: the Modal app. Both models and all voices load into a GPU memory snapshot, so a cold start takes about 11 s. At most 2 machines; each stops 5 minutes after its last line.
- `refs/`: the reference recordings, from the CSTR VCTK Corpus (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/). See `refs/README.md` for the speakers and the source.
- `check.py`: makes every voice at every speed on the deployed server and prints timings and the cost so far.

## Commands (from the repo root, Windows needs `PYTHONUTF8=1`)

    python -m modal deploy voice-server/app.py
    python voice-server/check.py --whisper
    python -m pytest voice-server -q

`check.py` saves its clips to `voice-server/out` unless you pass `--out`.

Deploying doesn't happen on push. After a deploy, run `check.py` once before using the site: its first line makes the GPU snapshot, which takes about 2.5 minutes. Before a demo, warm the server by opening the site and waiting for "Your voice is ready."

## Settings in Vercel

`MODAL_SPEAK_URL` (the URL `modal deploy` prints for `Voice.web`), `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` (a proxy token from Modal's dashboard, Settings, Proxy Auth Tokens).
