import { describe, expect, it } from "vitest";

describe("test setup", () => {
  it("runs in a DOM environment", () => {
    const el = document.createElement("p");
    el.textContent = "ready";
    expect(el).toHaveTextContent("ready");
  });
});
