# OnBeat

OnBeat is a web app for people who can't speak and have to communicate by typing. It listens to the person they're talking with and suggests short replies they can say out loud with one tap.

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

Listening works: the other person's speech is captioned in the browser and replies are prepared while they talk. Eval results are in [eval/RESULTS.md](eval/RESULTS.md). Settings, notes editing and the first-run flow are next.

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
