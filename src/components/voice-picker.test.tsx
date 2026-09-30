import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_VOICE, MALE_NOTE, type VoiceChoice } from "@/lib/voice/choices";
import type { VoiceEngine } from "@/lib/voice/engine";
import { VoicePicker, VoiceScreen } from "./voice-picker";

const fakeVoice = () => ({ speak: vi.fn(async () => {}), stop: vi.fn() }) as unknown as VoiceEngine & { speak: ReturnType<typeof vi.fn> };

function Harness({ voice, mode = "natural" as const }: { voice: VoiceEngine; mode?: "natural" | "loading" | "basic" }) {
  const [value, setValue] = useState<VoiceChoice>(DEFAULT_VOICE);
  return <VoicePicker value={value} onChange={setValue} name="Tom" voice={voice} mode={mode} progress={40} />;
}

describe("VoicePicker", () => {
  it("changes the styles with the voice and accent, and shows the male note", async () => {
    render(<Harness voice={fakeVoice()} />);
    expect(screen.getByRole("radio", { name: "Soft" })).toBeVisible();
    await userEvent.click(screen.getByRole("radio", { name: "Male" }));
    expect(screen.getByRole("radio", { name: "Calm" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Soft" })).toBeNull();
    expect(screen.getByText(MALE_NOTE)).toBeVisible();
    await userEvent.click(screen.getByRole("radio", { name: "British" }));
    const styleRadios = within(screen.getByRole("group", { name: "Style" })).getAllByRole("radio");
    const styleNames = styleRadios.map((r) => r.closest("label")?.textContent ?? "");
    expect(styleNames).toEqual(["Calm", "Warm"]);
  });

  it("plays a sample in the chosen voice and speed", async () => {
    const voice = fakeVoice();
    render(<Harness voice={voice} />);
    await userEvent.click(screen.getByRole("radio", { name: "Male" }));
    await userEvent.click(screen.getByRole("radio", { name: "Faster" }));
    await userEvent.click(screen.getByRole("button", { name: "Play a sample" }));
    expect(voice.speak).toHaveBeenCalledWith("Hi, I'm Tom. This is how I'll sound.", { voice: "am_michael", speed: 1.15 });
  });

  it("pressing Play a sample twice calls voice.speak twice and never calls onChange", async () => {
    const voice = fakeVoice();
    const onChange = vi.fn();
    render(
      <VoicePicker value={DEFAULT_VOICE} onChange={onChange} name="Tom" voice={voice} mode="natural" progress={0} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Play a sample" }));
    await userEvent.click(screen.getByRole("button", { name: "Play a sample" }));
    expect(voice.speak).toHaveBeenCalledTimes(2);
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
    expect(onSave).toHaveBeenCalledWith({ gender: "male", accent: "american", style: "calm", speed: "normal" });
  });
});
