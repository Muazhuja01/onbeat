# Research notes & decisions log

Background research and decisions made while designing OnBeat (brainstorming, 2026-09-27).
The design spec in `docs/superpowers/specs/` is the source of truth once written; this file records *why*.

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-09-27 | Build a context-aware AAC "phrase copilot" with personal-memory RAG | Real, under-served problem; measurable; stronger portfolio piece than document-chat RAG |
| 2026-09-27 | Users: literate nonspeaking people, **both hearing and Deaf** | Includes ALS, stroke, laryngectomy, CP, autistic adults, and Deaf nonspeaking users |
| 2026-09-27 | English core; any language can be added as a **language pack** gated by verified sources | Trust tiers (generative / retrieval-only / unsupported), promoted only by eval results |
| 2026-09-27 | Bangla = candidate second pack (post-v1) | Severe SLT shortage in Bangladesh; open speech data; author can verify |
| 2026-09-27 | Indigenous languages = future **community-provided, retrieval-only** packs, never LLM-generated | OCAP® data sovereignty; LLMs invent words in these languages |
| 2026-09-27 | No research write-up; deliverable is a **120-second demo video** + small eval table | Portfolio focus |
| 2026-09-27 | All free: Groq (primary) + Cerebras (fallback) LLMs, in-browser Kokoro TTS, Moonshine ASR, local embeddings | Zero cost; local-first privacy |
| 2026-09-27 | Differentiators: ① reply-ready before partner finishes, ② live reactions, ③ sounds like you, ④ (stretch) remembers people | Nobody offers replies at conversational speed |
| 2026-09-27 | Deferred: switch-scanning input, Bangla pack, face-to-face split screen (dropped) | Fit ~40 hours |
| 2026-09-27 | Name: **OnBeat** | "Without missing a beat" — replies land on time. Other OnBeat apps are fitness/video/music, none in AAC |

## Key facts

- Conversational turn gap ≈ 200 ms; AAC users type ~12–18 wpm vs 125–185 wpm speech. Slow AAC replies make partners view users as less capable.
- AAC users trade some agency for speed when timing matters (timely-humour study, 2024).
- Existing products: Apple Live Speech / Google Live Transcribe (type-to-speak, captions), Proloquo4Text (word prediction), Google SpeakFaster (research; LLM abbreviation expansion, 29–60% faster for ALS users), Ma-Talk AI (children, picture replies, "under 10 seconds").
- Free-tier LLMs change without notice (Groq dropped Llama from free tier on 2026-08-16) → provider-agnostic client with fallback.
- Gemini free tier may use prompts for training → unsuitable for personal memories.

## Sources

- SpeakFaster — https://www.nature.com/articles/s41467-024-53873-3
- Ma-Talk AI — https://apps.apple.com/us/app/matalk-ai/id6747360381
- Timing in turn-taking — https://pmc.ncbi.nlm.nih.gov/articles/PMC4464110/
- AAC communication-rate gap — https://www.researchgate.net/publication/376110365
- Backchanneling in AAC (2025) — https://arxiv.org/pdf/2506.17890
- Timely humour in AAC — https://arxiv.org/pdf/2410.16634
- "The less I type, the better" (CHI 2023) — https://dl.acm.org/doi/fullHtml/10.1145/3544548.3581560
- Context-aware AAC (Griffen et al., 2026) — https://doi.org/10.1177/01626434261420393
- Kokoro.js — https://huggingface.co/posts/Xenova/620657830533509
- Moonshine Web — https://huggingface.co/posts/Xenova/486935205804807
- Groq speech-to-text — https://console.groq.com/docs/speech-to-text
- OCAP® — https://mdl.library.utoronto.ca/mdl-blog/first-nations-principles-ownership-control-access-and-possession-ocapr-pathway-data
- Bangladesh CP Register (SLT shortage) — https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0250640
