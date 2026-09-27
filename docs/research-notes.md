# Research notes

Background research and decisions from the design phase (September 2026). The design spec will live in `docs/superpowers/specs/` once it's written.

## Decisions

**Who it's for.** Literate people who can't speak, both hearing and Deaf. This includes people with ALS, stroke, cerebral palsy, a laryngectomy, and nonspeaking autistic adults.

**Scope for v1.** English only, as a web app. The other person's speech is captioned. Replies are suggested from the user's saved notes and read aloud with a text-to-speech voice.

**Main features.**
1. Replies are prepared while the other person is still talking, so they're ready when they stop. The aim is about one second from their last word to the user's reply.
2. Short one-tap reactions ("Really?", "Oh no") suggested during the other person's turn.
3. Suggestions are written in the style of the user's own past sentences.
4. Stretch goal: with the user's approval, remember things people mention and bring them up later.

**Languages.** Each language is a separate pack. A language can use generated replies only if it passes an evaluation checked by native speakers. Otherwise it's limited to a verified phrase list. Bangla is the likely second language. Indigenous languages would only be added as phrase lists supplied by the communities themselves (see OCAP® below).

**Cost.** Everything runs on free tiers: Groq with Cerebras as a fallback for the language model, and Kokoro and Moonshine running in the browser. The free Gemini tier was ruled out because prompts may be used for training.

**Left out of v1.** Switch-scanning input, the Bangla pack, a split face-to-face screen, and a written report. The deliverable is a two-minute demo video plus a small evaluation.

**Name.** OnBeat, from "without missing a beat". Other apps with this name are for fitness, video editing and music, not communication.

## Useful facts

- Turn-taking gaps in conversation are around 200 ms. AAC users type roughly 12 to 18 words per minute, compared with 125 to 185 for speech.
- Slow replies lead conversation partners to see AAC users as less capable or less engaged.
- When timing matters, AAC users are willing to give up some control in exchange for speed (timely-humour study, 2024).
- Existing tools: Apple Live Speech and Google Live Transcribe (type-to-speak and captions), Proloquo4Text (word prediction), Google's SpeakFaster (research, LLM abbreviation expansion, 29 to 60% faster for two ALS users), and Ma-Talk AI (picture-based replies for children).
- Free tiers change without notice. Groq removed Llama models from its free tier on 16 August 2026.

## Sources

- SpeakFaster: https://www.nature.com/articles/s41467-024-53873-3
- Ma-Talk AI: https://apps.apple.com/us/app/matalk-ai/id6747360381
- Timing in turn-taking: https://pmc.ncbi.nlm.nih.gov/articles/PMC4464110/
- AAC communication rate: https://www.researchgate.net/publication/376110365
- Backchanneling in AAC (2025): https://arxiv.org/pdf/2506.17890
- Timely humour in AAC: https://arxiv.org/pdf/2410.16634
- "The less I type, the better" (CHI 2023): https://dl.acm.org/doi/fullHtml/10.1145/3544548.3581560
- Context-aware AAC (Griffen et al., 2026): https://doi.org/10.1177/01626434261420393
- Kokoro.js: https://huggingface.co/posts/Xenova/620657830533509
- Moonshine Web: https://huggingface.co/posts/Xenova/486935205804807
- Groq speech-to-text: https://console.groq.com/docs/speech-to-text
- OCAP®: https://mdl.library.utoronto.ca/mdl-blog/first-nations-principles-ownership-control-access-and-possession-ocapr-pathway-data
- Bangladesh Cerebral Palsy Register: https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0250640
