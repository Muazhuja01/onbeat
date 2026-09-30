import { describe, expect, it } from "vitest";
import { learnJudgeMessages, parseLearnVerdicts, voteLearn, type LearnVerdict } from "./judge";

describe("learnJudgeMessages", () => {
  it("lists the lines, notes, expected facts and suggestions", () => {
    const [, user] = learnJudgeMessages({
      today: "2026-10-05",
      lines: [{ speaker: "partner", text: "Your physio moved to Thursdays.", partnerName: "Leila" }, { speaker: "user", text: "OK." }],
      notes: ["I have physio on Tuesdays at 10:30."],
      expected: [{ action: "edit", fact: "Physio is now on Thursdays at 10:30.", oldText: "I have physio on Tuesdays at 10:30." }],
      shown: [{ action: "edit", text: "I have physio on Thursdays at 10:30.", oldText: "I have physio on Tuesdays at 10:30." }],
    });
    expect(user.content).toContain("- Leila: Your physio moved to Thursdays.");
    expect(user.content).toContain("- Me: OK.");
    expect(user.content).toContain('1. [change to: "I have physio on Tuesdays at 10:30."] Physio is now on Thursdays at 10:30.');
    expect(user.content).toContain('1. [change] "I have physio on Tuesdays at 10:30." -> "I have physio on Thursdays at 10:30."');
    expect(user.content).toContain("Today is Monday 5 October 2026.");
  });

  it("says when nothing is worth a note", () => {
    const [, user] = learnJudgeMessages({ today: "2026-10-05", lines: [{ speaker: "user", text: "Hi" }], notes: [], expected: [], shown: [{ action: "add", text: "x" }] });
    expect(user.content).toContain("(none: nothing here is worth a note)");
  });
});

describe("parseLearnVerdicts", () => {
  it("reads one verdict per suggestion", () => {
    const text = '{"suggestions": [{"n": 1, "keep": true, "invented": [], "matches": 1}, {"n": 2, "keep": false, "invented": ["4pm"], "matches": null}]}';
    expect(parseLearnVerdicts(text, 2)).toEqual([
      { n: 1, keep: true, invented: [], matches: 1 },
      { n: 2, keep: false, invented: ["4pm"], matches: null },
    ]);
  });

  it("refuses an answer that skips a suggestion or isn't JSON", () => {
    expect(parseLearnVerdicts('{"suggestions": [{"n": 1, "keep": true, "invented": [], "matches": null}]}', 2)).toBeNull();
    expect(parseLearnVerdicts("I think they are fine", 1)).toBeNull();
  });
});

describe("voteLearn", () => {
  const v = (keep: boolean, invented: string[], matches: number | null): LearnVerdict[] => [{ n: 1, keep, invented, matches }];
  it("takes the majority for each suggestion", () => {
    expect(voteLearn([v(true, [], 1), v(false, ["x"], null), v(true, [], 1)])).toEqual([{ n: 1, keep: true, invented: [], matches: 1 }]);
  });
  it("ignores unreadable calls, and gives up if all are unreadable", () => {
    expect(voteLearn([null, v(false, ["x"], null)])).toEqual([{ n: 1, keep: false, invented: ["x"], matches: null }]);
    expect(voteLearn([null, null])).toBeNull();
  });
});
