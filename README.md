# OnBeat

**Conversation at the speed of speech — for people who can't speak.**

OnBeat is a web app for nonspeaking people — both hearing and Deaf — who communicate by typing. It listens to the person they're talking with, understands the moment, and has personal, ready-to-speak replies waiting the instant the other person stops talking. One tap, and a natural human-sounding voice says it.

> **Status:** 🧭 design phase. No application code yet — the design spec lands in `docs/superpowers/specs/` first.

## The problem

People take turns in conversation about **200 ms** apart. People who use AAC (augmentative and alternative communication) type at roughly **12–18 words per minute**, versus 125–185 for speakers. By the time a reply is typed, the conversation has moved on — and research shows partners start treating slow repliers as less capable or disengaged.

Captions and type-to-speak already exist for free on every phone. What doesn't exist is replying **on the beat**.

## What makes OnBeat different

| | Feature | Why it matters |
|---|---|---|
| ① | **Reply-ready before they finish talking** — suggestions are prepared from the live transcript while the partner is still speaking | Target: ~1 s from the partner's last word to the user's voice |
| ② | **Live reactions** — one-tap "Ha!", "Really?", "Oh no" that fit what's being said *right now* | Lets users take part *during* the other person's turn, not only after |
| ③ | **Sounds like you** — suggestions are styled on the user's own past sentences | Answers the #1 complaint about AI in AAC: "it puts words in my mouth" |
| ④ | *(stretch)* **Remembers people** — consent-based memory of what partners share | Moves AAC beyond requests toward friendship |

**Principles:** the user always chooses — nothing is spoken without a tap · memory stays on the device · no invented facts · every spoken line is also shown as a large caption.

## Planned stack

Next.js + TypeScript · in-browser hybrid search (Orama + IndexedDB) · Transformers.js embeddings · Moonshine Web speech recognition · Silero VAD · Kokoro TTS · Groq + Cerebras LLM APIs (free tiers) · Vitest · Playwright + axe

## Roadmap

- [ ] Design spec approved
- [ ] Implementation plan
- [ ] Memory + retrieval + eval set
- [ ] Suggestions + tap-to-speak UI
- [ ] Live listening, speculative replies, reactions
- [ ] Eval results, deployment, 120-second demo video
- [ ] Language packs (Bangla next)

## License

[MIT](LICENSE)
