# OnBeat voice choice

Date: 2026-09-30. Status: the owner asked for this ("when creating your profile, you should have an option to select what kind of voice you want ... male or female, and then subsections on what type of voice ... options to change it in the future anytime") and agreed the choices and the design below in conversation (marked **(agreed)**). Details added while writing are marked **(decided)**.

## Why

Every profile speaks with the same voice today (Kokoro's Heart, female, American). A reply is spoken as the user's own voice, so a man hears himself as a woman, and nobody can choose how they sound. Setup should ask, and the choice should be easy to change.

Success looks like this: a new user picks a voice that feels like theirs in a few taps, hears it before they commit, and can change it any time; switching profile switches voice.

## What Kokoro offers

About 21 English voices in American and British accents, with quality grades from Kokoro's own notes: the best female voice (Heart) is A, the best male ones (Michael, Fenrir, Puck) are C+. There is no neutral voice and pitch can't be changed; speed can. Only voices graded C or better are offered.

## Decisions

1. **Per profile (agreed).** Each profile keeps its own voice. Switching profile switches voice. Export and import carry it.
2. **Accent and style (agreed).** The picker asks Voice (Female, Male), Accent (American, British), Style, and Speed. Styles depend on voice and accent:

   | | American | British |
   |---|---|---|
   | Female | Warm (`af_heart`), Bright (`af_bella`), Soft (`af_nicole`) | Warm (`bf_emma`), Clear (`bf_isabella`) |
   | Male | Calm (`am_michael`), Deep (`am_fenrir`), Lively (`am_puck`) | Calm (`bm_george`), Warm (`bm_fable`) |

   The style words are best guesses from Kokoro's notes and are checked by ear with the sample player before release; a word can change without changing the design. **(table decided)**
3. **Speed (agreed).** Slower (0.85), Normal (1), Faster (1.15). **(values decided)**
4. **Default (agreed).** Female, American, Warm, Normal, today's voice. Profiles made before this change get it.
5. **Setup (agreed).** A new step 3 of 4, "How should your voice sound?", after "Tell OnBeat about you" and before "Who do you talk to, and where?". Skip keeps the default.
6. **Sample (agreed).** "Play a sample" speaks "Hi, I'm <name>. This is how I'll sound." in the chosen voice and speed. While the voice is still downloading, the button is disabled and says "Voice loading, 40%" (the existing progress), so a different voice is never played as the sample. If the good voice can't load at all, the button says the device voice will be used instead. **(wording decided)**
7. **Honest note (agreed).** With Male chosen, a line under the picker says "Male voices sound a little less natural than female ones for now."
8. **Changing it (agreed).** A "Voice" item in the profile menu shows the current choice ("Voice: Male, American, calm"). Settings gets a "Voice" row with the same summary and a Change button. Both open the same picker as setup, as its own screen with Save and Cancel. Not shown in demos' menus as a setting to save; a demo speaks with its person's voice.
9. **Demos (agreed).** Maya and Aisha: Female, American, Warm. Tom: Male, American, Calm. **(voices decided)**
10. **After a change (agreed).** Replies already prepared as audio are thrown away and prepared again in the new voice, so an old voice never plays after a change.
11. **Basic voice (agreed).** When Kokoro can't run, the device's own speech is used as now. Browsers don't say which of their voices are male or female, so it can't follow the choice; Settings' Voice row says "Using your device's voice" while that is the case. **(wording decided)**

## Out of scope

Voices in other languages, pitch, custom or cloned voices, a voice per person talked to, cloud voices.

## Architecture

- **`src/lib/voice/choices.ts`** (new): the voice table, `VoiceChoice` (`{ gender, accent, style, speed }`), `DEFAULT_VOICE`, `voiceId(choice)`, `speedValue(choice)`, `stylesFor(gender, accent)`, `describeVoice(choice)` ("Male, American, calm"), and `isVoiceChoice(value)` for checking stored and imported data.
- **Profile record:** `ProfileInfo` gains `voice?: VoiceChoice`; `registry.setVoice(id, choice)`. Missing means the default.
- **Engine:** `VoiceEngine`'s `voice()` and `speed()` read the open profile's choice (a small module-level "current voice" the conversation screen sets when a profile or demo opens and when the choice changes). The prepared-clip cache is already keyed by voice, speed and text, so a clip made in the old voice is never played after a change. The old `onbeat:voice` localStorage key is no longer read.
- **Sample:** `VoiceEngine.sample(text, choice)` speaks with a given choice without changing the current one, so the picker can play a choice before it is saved.
- **UI:** `src/components/voice-picker.tsx` (the fields, the sample button, the note), used by setup step 3 and by a `voice` view in the conversation screen. Profile menu and Settings get their entries.
- **Export and import:** the profile file gains `profile.voice`, checked with `isVoiceChoice`; a bad or missing value imports as the default.

## Testing

- Unit: the table (every style maps to a voice graded C or better), `describeVoice`, `isVoiceChoice`, the registry's `setVoice` and its persistence, engine cache keyed by voice (a clip made in one voice is not played after a change), sample playing without changing the current voice, export and import with and without a voice.
- Components: the picker (styles change with voice and accent; the male note; the sample button disabled while loading), setup's new step (Skip keeps the default; the choice is saved with the profile).
- End to end: set up with a male voice, check the engine was asked for `am_michael` (through the existing test hook for voice calls); change the voice from the profile menu and from Settings; switching profile switches voice; axe on the picker.
- By ear, before release: play every style once and adjust the style words if one is wrong.
