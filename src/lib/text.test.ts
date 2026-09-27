import { describe, expect, it } from "vitest";
import { normalize, tokenize } from "./text";

describe("normalize", () => {
  it("lowercases, strips accents and unifies apostrophes", () => {
    expect(normalize("Café")).toBe("cafe");
    expect(normalize("Zoë")).toBe("zoe");
    expect(normalize("O'Brien")).toBe("o'brien");
  });
});

describe("tokenize", () => {
  it("splits on anything that isn't a letter, digit or apostrophe", () => {
    expect(tokenize("Hi Sam, a large oat-milk latte!")).toEqual(["hi", "sam", "a", "large", "oat", "milk", "latte"]);
  });
  it("keeps times together", () => {
    expect(tokenize("at 9:30 please")).toEqual(["at", "9:30", "please"]);
  });
  it("returns an empty list for blank input", () => {
    expect(tokenize("   ")).toEqual([]);
  });
});
