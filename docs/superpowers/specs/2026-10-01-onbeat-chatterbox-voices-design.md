# OnBeat Chatterbox voices

Date: 2026-10-01. Status: the owner asked to replace the Kokoro voices with Chatterbox, without spending money, picked every voice by ear and agreed the design below in conversation (marked **(agreed)**). Details added while writing are marked **(decided)**.

## Why

Replies are spoken as the user's own voice. The owner found the Kokoro voices poor and, after listening to Chatterbox clips (https://github.com/resemble-ai/chatterbox, MIT), said the female voice was "perfect" and asked for male voices too. Every visitor should get Chatterbox, not only the owner's laptop **(agreed)**.

Success looks like this: on the live site, every reply, typed line, quick phrase and sample plays in the chosen Chatterbox voice about a second after it's needed; a cold start or an outage never leaves a line silent; nothing costs the owner money.

## What was measured

All throwaway code is in `C:/Users/hujai/chatterbox-local` (not in this repo).

- **Browser:** the ONNX build garbles on the owner's AMD GPU and takes 17 s per line on the processor. Ruled out.
- **Owner's laptop processor:** Nano 2.1 to 4.6 s per line, Turbo 3.7 to 10.6 s.
- **Modal T4 GPU** (`modal-spike/`), measured from the laptop: Nano 0.6 to 1.2 s per line, Turbo 0.8 to 1.8 s. Cold start 65 s without a snapshot; with a GPU memory snapshot, 148 s once after deploy (it makes the snapshot), then 21, 11 and 11 s. Both test runs together cost $0.09 of credit.
- **Hosting ruled out:** Hugging Face Spaces (new free accounts can't create CPU Spaces; ZeroGPU quota is small), Cloudflare Workers AI (no Chatterbox), DeepInfra (paid).
- **Speed:** Chatterbox has no speed control. WSOLA time-stretching warbled on slowed Turbo; Rubber Band's R3 engine was approved by the owner at 0.85 and 1.15.
- **Voices:** Chatterbox copies a voice from a recording over 5 s. References are 10 to 15 s of joined lines from VCTK (University of Edinburgh, CC BY 4.0). The float64 output of `norm_loudness` breaks cloning; casting it to float32 fixes it.

## Decisions

1. **Chatterbox on Modal for everyone (agreed).** Modal's Starter plan is $0 with $30 of compute credit a month. A card must be on file; the owner sets the spend limit to $0, so Modal stops instead of charging. A T4 costs about $0.70 an hour while on, billed per second.
2. **Voices (agreed).** Picked by the owner from 25 VCTK speakers plus the built-in voice; style words come from measured pitch, pace and tone and were approved by ear.

   | | American | Canadian | British |
   |---|---|---|---|
   | Female | Bright (built-in, Turbo), Clear (p341, Turbo), Calm (p294, Turbo), Warm (p362, Turbo) | Lively (p303, Turbo) | Calm (p228, Turbo), Bright (p250, Turbo) |
   | Male | Deep (p311, Turbo) | Warm (p363, Turbo) | Calm (p226, Nano), Warm (p232, Nano), Bright (p258, Nano), Gentle (p273, Nano) |

3. **Picker (agreed).** Same steps as today: Voice (Female, Male), Accent (American, Canadian, British), Style, Speed. A group with one voice shows its one style. The male-voice note goes.
4. **Speed (agreed).** Slower 0.85, Normal 1, Faster 1.15, made on the server with Rubber Band R3. Normal is not processed.
5. **Default (agreed).** Female, American, Bright, Normal.
6. **Existing choices move to the nearest voice (agreed).** Female American Warm, Bright, Soft become Bright, Clear, Calm. Female British Warm, Clear become Calm, Bright. Male American Calm, Deep, Lively all become Deep. Male British Calm, Warm stay Calm, Warm. This applies to stored profiles, imported files and demos. Maya and Aisha become Female, American, Bright; Tom becomes Male, American, Deep **(demo voices decided)**.
7. **Kokoro stays as the backup, loading as today (agreed).** Each Chatterbox voice has a fixed Kokoro partner of the same gender, and the same accent where Kokoro has one **(partners decided)**:

   | Chatterbox voice | Kokoro partner |
   |---|---|
   | Female American Bright, Warm | `af_heart` |
   | Female American Clear; Female Canadian Lively | `af_bella` |
   | Female American Calm | `af_nicole` |
   | Female British Calm | `bf_emma` |
   | Female British Bright | `bf_isabella` |
   | Male American Deep | `am_fenrir` |
   | Male Canadian Warm | `am_michael` |
   | Male British Calm, Gentle | `bm_george` |
   | Male British Warm, Bright | `bm_fable` |

8. **The browser reaches Modal through OnBeat's server (agreed).** The Modal token never reaches the browser.
9. **Credit for the voices (agreed).** The README and `voice-server/refs/README.md` credit VCTK under CC BY 4.0.

## Out of scope

The laptop-only helper (no longer needed), the user's own cloned voice, other languages, streaming audio as it is made, removing Kokoro, changing captions or replies.

## Architecture

### 1. Voice server (`voice-server/`, Python, deployed to Modal)

- `app.py`: Modal app `onbeat-voice` on a T4. Chatterbox pinned to commit `5de7a54` of the GitHub repo. The image downloads both models at build time and installs `rubberband-cli` **(decided)**.
- A class with `enable_memory_snapshot=True` and `experimental_options={"enable_gpu_snapshot": True}`. `@modal.enter(snap=True)` loads Nano and Turbo on the GPU, prepares the conditionals of all 13 voices once, and warms each model with one line.
- Voice table (`voices.py`): id to model and reference file, for example `f_us_bright` (Turbo, built-in), `m_gb_gentle` (Nano, `refs/p273.wav`). The same ids are used in the app **(ids decided)**.
- Two web endpoints, both with Modal proxy auth (a token id and secret sent as headers): `POST /speak` takes `{text, voice, speed}` and returns a 24 kHz 16-bit mono WAV; `POST /warm` starts the machine and returns when the models are ready.
- Limits: `max_containers=2`, `scaledown_window=300`. One line at a time per machine.
- `refs/`: the 12 reference clips and a README with the VCTK credit.
- Deployed with `modal deploy voice-server/app.py` from the laptop. Pushing to GitHub doesn't deploy it. Claude asks before each deploy.

### 2. `/api/speak` (Next.js route on Vercel)

Built like `/api/transcribe`: same-origin only, a per-address rate limit (90 a minute for lines, 10 a minute for wake calls) **(limits decided)**, nothing stored or logged.

- `POST /api/speak` with `{text, voice, speed}`: text of 1 to 300 characters, a voice id from the table, a speed of 0.85, 1 or 1.15; else 400. Forwards to Modal with a 25 s timeout and returns the WAV as `audio/wav`. Missing settings, a timeout or any Modal error give 503.
- `POST /api/speak?warm=1`: forwards to `/warm`; 204 when ready, 503 otherwise.
- New Vercel settings: `MODAL_SPEAK_URL`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`. The owner creates the proxy token in Modal's dashboard and adds the settings with a script, as before; Claude never sees the secret.

### 3. Browser

- `src/lib/voice/choices.ts`: the new table (Chatterbox id, Kokoro partner, style word per voice), the Canadian accent, the default and the old-to-new mapping in `normalizeChoice`.
- `src/lib/voice/router.ts` (new): implements `WorkerLike`, sits where the Kokoro worker sits today, and owns the Kokoro worker. It sends each line to `/api/speak`, and to the Kokoro worker with the partner voice when the rules below say so. It decodes the WAV into samples. It tells the engine `ready` as soon as either Chatterbox is awake or Kokoro has loaded, passes Kokoro's download progress through, and reports an error only when both have failed.
- `messages.ts`: `generate` gains `urgent` (the line is being said now) and `backup` (the Kokoro voice to use); `audio` gains `backup: true` for a Kokoro clip; a new `source` message says whether Chatterbox is waking, awake or down.
- `engine.ts`: up to 3 lines in progress at once, the line being said first. A backup clip is kept only until the router says Chatterbox is awake; then backup clips are dropped and the replies on screen are made again.
- `browser.ts`: builds the router instead of the bare Kokoro worker and sends the wake call when a profile or demo opens.
- Status line and notices: "Waking your voice…", "Your voice is ready", "Using the backup voice", and a notice under a line said by the backup **(wording decided; the existing device-voice notice stays for when neither works)**.

## Timing and failures

- **Wake.** When a profile or demo opens, one wake call. Awake when it returns or when any line comes back. After 5 minutes with no line, the router assumes Modal is asleep and the next line or tap wakes it again.
- **A line being said now** (tapped reply, typed line, quick phrase, sample): Chatterbox if awake, waiting up to 6 s **(decided)**; if Chatterbox is waking, slower than 6 s or failing, Kokoro says it and the backup notice shows. The engine's existing 20 s ceiling and device-voice fallback stay for when Kokoro isn't ready either.
- **Replies being prepared:** wait for Chatterbox; made by Kokoro only while Chatterbox is down.
- **Down.** Two failures in a row mark Chatterbox down: everything uses Kokoro and the status line says "Using the backup voice". A wake call every 60 s; when one works, back to Chatterbox and the status line says so. Credit running out looks like any other failure.
- **Cost guards:** the $0 spend limit, 2 machines at most, off after 5 idle minutes, the rate limit, 300 characters per line. Expected: about $0.12 for a 10-minute visit, about $0.20 for the demo.

## Privacy

The text of each spoken line goes through OnBeat's server to Modal to be voiced and is not stored or logged. The README's privacy lines and the Settings voice note say so. Notes and profiles still stay in the browser except in the jobs that already send them.

## Testing

- **Unit (Vitest):** every voice reachable in the picker and with a Kokoro partner; every old choice maps as in decision 6, in profiles, imports and demos. Router: a good Chatterbox line; a slow one goes to Kokoro after 6 s; while waking, a line being said goes to Kokoro and prepared replies wait; two failures mark it down and the 60 s retry recovers it; backup clips are dropped once awake; WAV decoding. Engine: 3 in progress, the line being said first. Route: other origins, rate limit, bad text, voice or speed, missing settings, Modal failure and timeout, the WAV passed through, the wake call.
- **End to end (Playwright, `/api/speak` faked with a WAV fixture):** the picker shows the 13 voices including Canadian; a sample plays; the backup notice appears when the route fails; an old profile opens with its new voice.
- **Voice server:** Python tests that run without a GPU (voice table, Rubber Band arguments, WAV output); a check script against the deployed server that makes every voice at every speed, times each line and one cold start, runs the Whisper check and prints the cost from `modal billing`.
- **Before merge:** the owner listens to one sample per voice from the deployed server, at Normal and one other speed. On a Vercel preview, Claude checks the wake, typed and tapped lines in the chosen voice, and the backup taking over with the Modal app stopped.

## Owner steps

1. Done: Modal account, laptop connected (`modal setup`, needs `PYTHONUTF8=1` on Windows).
2. Set the Modal spend limit to $0 (Settings, Usage & Billing).
3. Create a proxy auth token in Modal's dashboard and add the three Vercel settings with the script Claude provides.
4. Listen to the deployed voices before merge.
