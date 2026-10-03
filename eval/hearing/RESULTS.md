# Hearing eval

How well the listening pipeline captions real speech. `fetch.ts` downloads the test set, `run.ts` runs it through the app's hearing code (Silero VAD, `Segmenter`, Moonshine with `maxTranscriptTokens` and `trimRepeatedTail`) in Node.

```
npx tsx eval/hearing/fetch.ts          # about 180 MB into eval/hearing/.cache (git-ignored)
npx tsx eval/hearing/run.ts --split dev
```

## Test set

| Source | What it is | Licence |
|---|---|---|
| [AMI Meeting Corpus](https://huggingface.co/datasets/edinburghcstr/ami), `sdm` | Meetings recorded by one microphone in the middle of the table: real conversation, hesitations, people a metre or two away | CC BY 4.0 |
| [Common Voice 17](https://huggingface.co/datasets/fixie-ai/common_voice_17_0), English | Read sentences from many speakers and accents, each on their own microphone | CC0 |
| [DEMAND](https://zenodo.org/records/1227121), channel 1 | Real background noise: cafeteria (`PCAFETER`) and street traffic (`STRAFFIC`) | CC BY 4.0 |

100 clips per source for dev (the corpora's validation splits) and 100 for test (their test splits), picked with a fixed seed, at most 8 clips per AMI speaker and 2 per Common Voice speaker. AMI clips are 1 to 8 seconds with at least three words. Dev and test hear different halves of each noise recording.

Each clip is heard with 1 s of background before and 1.5 s after, in three conditions: a quiet room (café noise 30 dB below the speech), café chatter at 10 dB below, and street traffic at 5 dB below.

Measures, per clip: word errors against the transcript (lowercased, punctuation and "um"/"uh" removed), **cut off** (under half the words came out), **split** (one sentence shown as several lines), **missed** (no caption; in the app the caption would wait for the next pause).

This is closer to real use than synthetic speech but it is not a phone at a café counter: no browser audio processing, AMI is British and European meeting talk, and Common Voice is read aloud.

## Results on dev (2026-09-29)

Moonshine tiny unless noted. Enter/exit are the VAD probabilities that start a turn and keep it going; pause is the silence that ends it.

| Setting | Word errors | Exact | Cut off | Split | Missed | Café: missed |
|---|---|---|---|---|---|---|
| Before the token fix (library limit) | 44.9% | 11.8% | 13.5% | 10.5% | 8.2% | 25% |
| App now: 0.3 / 0.1, 600 ms | 44.6% | 12.8% | 10.7% | 10.5% | 8.2% | 25% |
| 0.4 / 0.25, 600 ms | 45.5% | 11.8% | 10.2% | 12.5% | 6.8% | 9% |
| 0.5 / 0.35, 600 ms (Silero's defaults) | 46.4% | 12.3% | 10.7% | 13.0% | 6.7% | 7% |
| 0.5 / 0.35, 800 ms | 45.6% | 12.2% | 11.0% | 7.0% | 6.7% | 9% |
| 0.5 / 0.35, 1000 ms | 45.2% | 12.2% | 11.3% | 3.8% | 7.3% | 14% |
| Moonshine base, 0.3 / 0.1, 600 ms | 36.0% | 22.2% | 11.2% | 9.5% | 8.5% | 26% |

Café: missed is Common Voice in café noise.

What this shows:

- **The token fix** cut captions that stop early on short AMI turns from 14% to 11% (quiet) and 19% to 13% (café). Common Voice clips are 4 to 6 s, where the old limit rarely bit.
- **Café chatter keeps turns open.** Silero rates background talk at 0.2 to 0.4, above the 0.1 that keeps a turn going, so 25% of café clips never reached a pause within 1.5 s. Stricter thresholds fix most of that (9% at 0.4 / 0.25) but miss more quiet, distant speech.
- **Longer pauses split fewer sentences** (10.5% at 600 ms to 3.8% at 1000 ms) and every extra 100 ms delays captions and replies by 100 ms.
- **Moonshine base** is the largest gain: word errors 45% to 36%, exact captions 13% to 22%. It is 122 MB against 53 MB and took 175 ms against 118 ms per clip here.
- **Tried and dropped:** keeping 300 ms around each turn instead of 96 ms (no gain on synthetic speech), and a loudness gate against the background level (street noise got much worse, café barely better).

For scale: large models such as Whisper large score about 35% word errors on AMI's table microphone. The test set is hard on purpose.

## Cloud models on dev (2026-09-29)

Same clips, same turn settings (0.3 / 0.1, 600 ms), each finished turn sent to a cloud service instead of Moonshine. Scored with the Whisper-style normalizer (contractions, numbers, British spellings), which the Moonshine rows above predate; `rescore.ts` puts every run on the current scorer, and the Moonshine rows here are re-scored.

```
npx tsx eval/hearing/run.ts --split dev --model cf:nova-3
npx tsx eval/hearing/run.ts --split dev --model groq:whisper-large-v3-turbo
npx tsx eval/hearing/rescore.ts eval/results/hearing-dev-*.json
```

| Model | Where | Word errors, all | Common Voice quiet | CV café | CV street | AMI quiet | Exact | Missed | Time per turn |
|---|---|---|---|---|---|---|---|---|---|
| Moonshine tiny (in the app) | Browser | 44.7% | 28.6% | 59.5% | 36.0% | 40.0% | 12.8% | 8.2% | 123 ms (CPU) |
| Moonshine base | Browser | 35.7% | 20.1% | 48.3% | 24.2% | 35.6% | 22.2% | 8.5% | 181 ms (CPU) |
| Deepgram Nova-3 | Cloudflare Workers AI | 28.1% | 12.5% | 37.4% | 14.9% | 30.6% | 30.0% | 10.8% | 394 ms round trip |
| Whisper large-v3-turbo | Groq | 29.6% | 12.5% | 42.7% | 15.5% | 29.8% | 30.0% | 6.3% | 379 ms round trip |
| Whisper large-v3 | Groq | 29.3% | 11.4% | 42.7% | 14.2% | 30.7% | 29.8% | 6.3% | 443 ms round trip |
| Parakeet TDT 0.6B v3 (what Handy uses), int8 | This CPU, sherpa-onnx | 31.4% | 16.8% | 42.2% | 21.7% | 32.6% | 25.2% | 8.8% | 191 ms (CPU) |

What this shows:

- **Any of the three cloud models roughly halves the word errors on clear speech** (28.6% to 11 to 13%) and cuts street noise from 36% to about 15%. They are within 1.5 points of each other overall.
- **Whisper makes up "Thank you."** when there is only background noise: 33 turns with turbo and 38 with large-v3, out of 600, none of which contain those words (29 to 31 of them in café noise, so about 1 in 7 café clips). In OnBeat that is a caption of something the other person never said, and replies to it. Nova-3 never did this. Nova-3 instead leaves more faint, distant speech blank (missed 10.8%).
- **Parakeet v3** (the model in the [Handy](https://github.com/cjpais/handy) dictation app) is better than Moonshine base but behind the three cloud models, most on clear speech (16.8% against 11 to 13%) and street noise (21.7% against 14 to 16%). It invented little (4 "Okay." lines). It is also too big for the browser (670 MB) and for a Vercel function, so it would need its own server.
- **Nova-3, falling back to Moonshine when it returns nothing** (simulated from the saved runs; the turns are cut the same way whatever the model): word errors 27.7%, missed 7.2%.
- **Stricter turn thresholds with Nova-3** (0.4 / 0.25, 600 ms): café 37.4% to 27.9%, but quiet 12.5% to 13.8%, street 14.9% to 16.6%, AMI 30.6% to 32.5%, all 28.1% to 29.7%. A trade, not a clear win.
- **Cost and limits.** Cloudflare's free daily allowance (10,000 neurons) ran out part way through the third full Nova-3 run, so it covers roughly 1,500 turns a day for everyone together, and the same allowance serves the reply fallback. Real use needs the Workers Paid plan (usage-priced) or a Deepgram account. Groq's free tier allows 20 Whisper requests a minute.

### Recommendation

Keep Moonshine in the browser for the live caption while someone talks, and send each finished turn to **Deepgram Nova-3** for the final caption and the replies, using Moonshine's text when Nova-3 returns nothing or doesn't answer within a couple of seconds. Not Whisper, because of the invented "Thank you." lines.

**Built (2026-09-30), opt-in as the owner chose:** the "Clearer captions" setting sends each finished turn to `/api/transcribe` (Nova-3 on Cloudflare). The in-browser caption is kept when Nova-3 returns nothing, errors, is rate-limited or takes over 2.5 s, and after a failure the app skips the cloud for a minute. Off by default, because the other person's voice leaves the device. Real use still needs a paid Cloudflare plan: the free allowance is about 1,500 turns a day. **On by default from 2026-10-03**, at the owner's request, for new and existing users; turning it off in Settings is remembered.

Keep the turn thresholds at 0.3 / 0.1 unless café use matters most; then 0.4 / 0.25.

The test split has not been used yet. It is for one check of Nova-3 with the Moonshine fallback, once Cloudflare's allowance allows (it was used up on 2026-09-30).

## Long speech: live captions fell behind (2026-10-02)

Two screen recordings from the owner showed live captions running far behind someone who talked for a long time without stopping: about 10 s behind on a 20 s monologue, and still writing words 53 s after a 62 s one ended. The screen also jumped as captions and replies changed.

**Why.** Every live caption re-read the whole turn from its start, and one was due for each 0.5 s of audio. A turn only ended after a 600 ms pause, so a talker who never paused that long made one turn up to the 30 s cap. Once re-reading took over 0.5 s (about 20 s of audio here), each half second of speech cost up to four times as long to read, and the delay grew without limit. Speech detection waited in the same queue, so the turn's end was late too.

**Change.** A turn is now cut into pieces of 2 to 6 s: at the first 160 ms dip under the speech threshold once a piece is 2 s long, or at the quietest frame of the last 2 s by 6 s. Each piece is read once and kept; the live caption is the kept pieces plus a reading of the piece being spoken. Frames go through speech detection before any reading, and a live caption reads the newest audio when it runs, so a slow reading can't leave a queue of stale ones. When a piece's own reading has under half the words of its last live reading (Moonshine looped on one piece, "year 10, 10, 10", trimmed to "10,"), the live reading is kept instead.

**Measured** by playing each recording into Chromium as a fake microphone on the owner's machine (16 threads, cross-origin isolated), against the live site and the change. Layout shift is Chrome's cumulative layout shift while listening.

| Recording | Version | Last caption after speech ended | Layout shift |
|---|---|---|---|
| 20 s monologue | live site | 10 s in the owner's recording | – |
| 20 s monologue | this change | 0.7 s | 0.21 |
| 62 s monologue | live site | 22 s (32 s at the slowest run) | 2.13 |
| 62 s monologue | this change | on time | 0.48 |

The remaining layout shift is mostly the live line's own words growing. The screen side of the change: room for the scrollbar is always kept; once someone has spoken, the reactions row and three reply slots keep their space and the caption box has a fixed height; a set of replies still arriving doesn't replace a fuller one; and while the other person talks, replies stay on screen at least 5 s before newer ones (and their reactions) replace them.

Not measured: word error rate with pieces against whole turns. Pieces are 2 to 6 s, inside the 1 to 8 s clips the dev set uses.
