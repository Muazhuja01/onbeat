import type { SuggestRequestBody } from "./protocol";

export type ChatMessage = { role: "system" | "user"; content: string };

export function buildMessages(b: SuggestRequestBody): ChatMessage[] {
  const withReactions = b.mode === "replies+reactions";
  const notes = b.notes.length ? b.notes.map((n) => `[${n.id}] ${n.text}`).join("\n") : "(none)";
  const examples = b.examples.length ? b.examples.map((e) => `- ${e}`).join("\n") : "(none)";

  const lines = [
    "You help a person who cannot speak take part in a live spoken conversation. You write short replies they can choose to say out loud.",
    "",
    `Situation: ${b.contextLine}`,
    `The other person just said: ${b.partnerSaid ? `"${b.partnerSaid}"` : "(nothing yet)"}`,
    `The person has typed so far: ${b.typed ? `"${b.typed}"` : "(nothing yet)"}`,
    "",
    "Notes about the person's life. Use only these facts:",
    notes,
    "",
    "Things the person has said before. Match their style:",
    examples,
    "",
    "Rules:",
    "- Write exactly 3 replies, in first person, as the person.",
    `- Each reply is at most ${b.maxWords} words, plain and natural.`,
    "- Reply 1 answers directly. Reply 2 adds one detail from a note, only if a note gives one that answers what they said. If no note does, reply 2 is another plain answer that adds nothing new. Reply 3 gives the opposite (declining, or no) or a short neutral reply such as \"Not sure.\" or \"One moment, please.\". It never says what they will check, do or look at.",
    "- If the person has typed something, all 3 replies keep that meaning and differ only in wording or detail.",
    "- Say only what the notes, the situation or the conversation back up. Never add anything about the person that they don't: what they did, have, feel, want, plan or prefer, and no new names, places, numbers, days or times. Also don't say where they are, what they are doing right now, what they have with them, unless the situation or the notes say so.",
    "- Never contradict the notes. If a note says something about the person (for example that they can't hear, or don't drink tea), no reply may say or imply the opposite. Answer in line with the note instead.",
    '- If the notes don\'t answer the question, keep the reply short and general, or ask back. For example, if nothing says what they are doing this weekend, write "Not sure yet." or "How about you?", not "I\'m going hiking."',
    '- Don\'t offer choices the notes don\'t mention. If the notes say the usual order is a latte, don\'t suggest "Maybe a mocha today?".',
    "- For each reply, list the ids of the notes it uses.",
  ];

  if (withReactions) {
    lines.push(
      "- Also pick the 2 reactions from this list that best fit what the other person said:",
      b.reactions.map((r) => `${r.id}: ${r.text}`).join("\n"),
    );
  }

  lines.push(
    "",
    "Output format: one JSON object per line and nothing else. No markdown, no explanations.",
    '{"reply": "...", "notes": ["note-id"]}',
    '{"reply": "...", "notes": []}',
    '{"reply": "...", "notes": []}',
  );
  if (withReactions) lines.push('{"reactions": ["id", "id"]}');

  return [
    { role: "system", content: "You write short, first-person spoken replies. Follow the output format exactly." },
    { role: "user", content: lines.join("\n") },
  ];
}
