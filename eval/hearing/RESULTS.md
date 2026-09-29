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

The test split has not been used yet; it is for checking the settings chosen on dev, once.
