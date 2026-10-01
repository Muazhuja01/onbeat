import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_VOICE, type VoiceChoice } from "@/lib/voice/choices";
import type { VoiceEngine } from "@/lib/voice/engine";
import { VoicePicker, VoiceScreen } from "./voice-picker";

const fakeVoice = () =>
  ({ speak: vi.fn(async () => {}), sample: vi.fn(async () => {}), stop: vi.fn() }) as unknown as VoiceEngine & {
    speak: ReturnType<typeof vi.fn>;
    sample: ReturnType<typeof vi.fn>;
  };

function Harness({ voice, mode = "natural" as const }: { voice: VoiceEngine; mode?: "natural" | "loading" | "basic" }) {
  const [value, setValue] = useState<VoiceChoice>(DEFAULT_VOICE);
  return <VoicePicker value={value} onChange={setValue} name="Tom" voice={voice} mode={mode} progress={40} />;
}

describe("VoicePicker", () => {
  it("changes the styles with the voice and accent", async () => {
    render(<Harness voice={fakeVoice()} />);
    expect(screen.getByRole("radio", { name: "Clear" })).toBeVisible();
    await userEvent.click(screen.getByRole("radio", { name: "Male" }));
    expect(screen.getByRole("radio", { name: "Deep" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Clear" })).toBeNull();
    expect(screen.queryByText(/less natural/)).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Canadian" }));
    expect(screen.getByRole("radio", { name: "Warm" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "British" }));
    const styleRadios = within(screen.getByRole("group", { name: "Style" })).getAllByRole("radio");
    const styleNames = styleRadios.map((r) => r.closest("label")?.textContent ?? "");
    expect(styleNames).toEqual(["Calm", "Warm", "Bright", "Gentle"]);
  });

  it("plays a sample in the chosen voice and speed", async () => {
    const voice = fakeVoice();
    render(<Harness voice={voice} />);
    await userEvent.click(screen.getByRole("radio", { name: "Male" }));
    await userEvent.click(screen.getByRole("radio", { name: "Faster" }));
    await userEvent.click(screen.getByRole("button", { name: "Play a sample" }));
    expect(voice.sample).toHaveBeenCalledWith("Hi, I'm Tom. This is how I'll sound.", { voice: "m_us_deep", speed: 1.15 });
    expect(voice.speak).not.toHaveBeenCalled();
  });

  it("says the sample is being prepared until it has played", async () => {
    const voice = fakeVoice();
    let finish = () => {};
    voice.sample.mockImplementation(() => new Promise<void>((r) => (finish = r)));
    render(<Harness voice={voice} />);
    await userEvent.click(screen.getByRole("button", { name: "Play a sample" }));
    // Marked unavailable but not disabled, so a keyboard user's focus stays on it.
    const preparing = screen.getByRole("button", { name: "Preparing sample" });
    expect(preparing).toHaveAttribute("aria-disabled", "true");
    expect(preparing).toBeEnabled();
    await userEvent.click(preparing);
    expect(voice.sample).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.getByRole("button", { name: "Play a sample" })).not.toHaveAttribute("aria-disabled");
  });

  it("pressing Play a sample twice plays two samples and never calls onChange", async () => {
    const voice = fakeVoice();
    const onChange = vi.fn();
    render(
      <VoicePicker value={DEFAULT_VOICE} onChange={onChange} name="Tom" voice={voice} mode="natural" progress={0} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Play a sample" }));
    await userEvent.click(screen.getByRole("button", { name: "Play a sample" }));
    expect(voice.sample).toHaveBeenCalledTimes(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("waits for the voice to load", () => {
    render(<Harness voice={fakeVoice()} mode="loading" />);
    expect(screen.getByRole("button", { name: "Voice loading, 40%" })).toBeDisabled();
  });

  it("says when the device voice will be used", () => {
    render(<Harness voice={fakeVoice()} mode="basic" />);
    expect(screen.getByText("Your device's voice will be used, and it may not match this choice.")).toBeVisible();
  });
});

describe("VoiceScreen", () => {
  it("saves the new choice", async () => {
    const onSave = vi.fn();
    render(<VoiceScreen initial={DEFAULT_VOICE} name="Tom" voice={fakeVoice()} mode="natural" progress={100} onSave={onSave} onCancel={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Your voice" })).toHaveFocus();
    await userEvent.click(screen.getByRole("radio", { name: "Male" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ gender: "male", accent: "american", style: "deep", speed: "normal", v: 2 });
  });
});
