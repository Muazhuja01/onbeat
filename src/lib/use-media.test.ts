import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useMedia } from "./use-media";

describe("useMedia", () => {
  afterEach(() => Reflect.deleteProperty(window, "matchMedia"));

  it("uses the given value when the browser can't tell", () => {
    expect(renderHook(() => useMedia("(min-width: 40rem)")).result.current).toBe(true);
    expect(renderHook(() => useMedia("(min-width: 40rem)", false)).result.current).toBe(false);
  });

  it("follows the media query as it changes", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    window.matchMedia = ((query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    })) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useMedia("(min-width: 40rem)"));
    expect(result.current).toBe(false);
    act(() => {
      matches = true;
      listeners.forEach((cb) => cb());
    });
    expect(result.current).toBe(true);
  });
});
