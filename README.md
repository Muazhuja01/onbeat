# OnBeat

OnBeat is a web app for people who can't speak and have to communicate by typing. It listens to the person they're talking with and suggests short replies they can say out loud with one tap.

Try it at https://onbeat-mu.vercel.app (set up a profile, or choose "Try a demo first" to use an example person; the speech and voice models download to your browser the first time).

It's meant for both hearing and Deaf users. The other person's speech is shown as live captions, and every reply the user speaks is shown on screen as well.

## Why

In spoken conversation, people usually reply within a fraction of a second. Typing on an AAC (augmentative and alternative communication) device is much slower, often 12 to 18 words per minute. By the time a reply is ready, the conversation has often moved on.

Phones already offer captions and type-to-speak. OnBeat tries to shorten the gap between hearing a question and answering it.

## How it will work

- The other person's speech is transcribed in the browser.
- While they're still talking, the app searches the user's saved notes (people, places, routines, things they've said before) and asks a language model for three short replies.
- The user picks one or types their own. Nothing is spoken until they tap.
- A reply is discarded if it mentions a name, number or time that isn't in the user's notes or the conversation.
- Notes are stored in the browser. Only the few notes relevant to the current reply are sent to the model.

## Status

Listening works: the other person's speech is captioned in the browser and replies are prepared while they talk. The app passes axe checks in light, dark and high-contrast themes and works with a keyboard alone. A small settings panel sets the theme (it follows the device's contrast setting by default) and turns the number-key shortcuts off for voice control users.

Profiles: the first visit asks for a name, a short note about the user, and a few people and places. Several people can keep profiles in one browser and switch between them. Notes can be added, edited and deleted at any time, and a profile can be exported to a file and imported again (for a backup or another device). Notes can also be started from a document (.txt, .md, .docx or .pdf): its text is sent to the language model, which suggests short notes, and the user picks which to keep. The example people are behind a demo link and are never saved.

Captions come from Moonshine in the browser. "Clearer captions" in Settings (off by default) sends each finished line from the other person to Deepgram Nova-3 through Cloudflare, which roughly halves the word errors on clear speech; the browser's caption is used whenever that service is slow or unavailable. Measurements are in [eval/hearing/RESULTS.md](eval/hearing/RESULTS.md).

Next: learning from conversations (suggested notes the user confirms), then an assistant chat for updating notes and preparing for conversations.

Results on the held-out test set (60 scenarios written before any tuning) for the default model `qwen/qwen3.8-27b`. Neither target (90% top-3 hit rate, under 5% invented details) is met; the owner accepted these numbers for the deploy. Details, method and known gaps are in [eval/RESULTS.md](eval/RESULTS.md).

| Claim check | Top-3 hit rate | Invented details | First reply p50 |
|---|---|---|---|
| off | 87% | 20 of 168 (12%) | 344 ms |
| on | 82% | 13 of 143 (9%) | 783 ms |

The judge flags plain answers too often, so the invented rates run high. The claim check is off by default. Setting `CLAIM_CHECK=on` makes the server check each reply with a second small model and hide the ones it calls invented. It lowers the invented rate and the hit rate, and adds about 440 ms to the first reply in the eval.

## Planned stack

Next.js and TypeScript, Orama for in-browser search, Transformers.js, Moonshine for speech recognition, Kokoro for text-to-speech, and the Groq and Cloudflare Workers AI APIs.

## Run it locally

You need Node 24.

1. `npm install`
2. Copy `.env.example` to `.env.local` and add free API keys from [Groq](https://console.groq.com/keys) and [Cloudflare Workers AI](https://dash.cloudflare.com) (open Workers AI, then "Use REST API" for the account ID and a token). The app still runs without them, but only past phrases are suggested.
3. `npm run dev` and open http://localhost:3000

The first visit downloads the voice (about 90 MB) and the search model (about 23 MB). Pressing Listen downloads speech recognition (about 53 MB) the first time. All are cached by the browser afterwards.

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run e2e`.

Eval: `npm run eval` (needs the API keys; about 20 minutes).

## License

MIT
