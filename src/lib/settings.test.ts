import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetSettings, getSettings, setCloudCaptions, setDigitKeys, setTheme, subscribeSettings } from "./settings";

afterEach(() => {
  localStorage.clear();
  forgetSettings();
  delete document.documentElement.dataset.theme;
});

describe("settings", () => {
  it("defaults to the system theme, number keys on and cloud captions off", () => {
    expect(getSettings()).toEqual({ theme: "system", digitKeys: true, cloudCaptions: false });
  });

  it("saves the cloud captions choice, and forgets it when turned off", () => {
    setCloudCaptions(true);
    expect(localStorage.getItem("onbeat:cloud-captions")).toBe("on");
    forgetSettings();
    expect(getSettings().cloudCaptions).toBe(true);
    setCloudCaptions(false);
    expect(localStorage.getItem("onbeat:cloud-captions")).toBeNull();
    expect(getSettings().cloudCaptions).toBe(false);
  });

  it("saves a theme and applies it to the page", () => {
    setTheme("contrast");
    expect(localStorage.getItem("onbeat:theme")).toBe("contrast");
    expect(document.documentElement.dataset.theme).toBe("contrast");
    expect(getSettings().theme).toBe("contrast");
  });

  it("goes back to following the system by removing the page theme", () => {
    setTheme("dark");
    setTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(getSettings().theme).toBe("system");
  });

  it("ignores an unknown saved theme", () => {
    localStorage.setItem("onbeat:theme", "sepia");
    expect(getSettings().theme).toBe("system");
  });

  it("saves the number-key choice", () => {
    setDigitKeys(false);
    expect(localStorage.getItem("onbeat:digit-keys")).toBe("off");
    expect(getSettings().digitKeys).toBe(false);
  });

  it("tells subscribers about changes and returns the same snapshot until something changes", () => {
    const cb = vi.fn();
    const off = subscribeSettings(cb);
    const before = getSettings();
    expect(getSettings()).toBe(before);
    setDigitKeys(false);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getSettings()).not.toBe(before);
    off();
    setDigitKeys(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("still works when storage is blocked", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(getSettings().theme).toBe("dark");
    spy.mockRestore();
  });
});
