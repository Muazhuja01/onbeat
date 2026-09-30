"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ACCENTS, GENDERS, MALE_NOTE, SPEEDS, normalizeChoice, sampleText, speedValue, stylesFor, voiceId, type VoiceChoice } from "@/lib/voice/choices";
import type { VoiceEngine, VoiceMode } from "@/lib/voice/engine";
import { hint, primaryButton, secondaryButton } from "./ui";

interface PickerProps {
  value: VoiceChoice;
  onChange: (v: VoiceChoice) => void;
  name: string;
  voice: VoiceEngine | null;
  mode: VoiceMode;
  progress: number;
}

function Choice<T extends string>({ legend, name, options, value, onPick }: { legend: string; name: string; options: { value: T; label: string }[]; value: string; onPick: (v: T) => void }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-label font-bold">{legend}</legend>
      <div className="flex flex-wrap gap-x-6">
        {options.map((o) => (
          <label key={o.value} className="flex min-h-12 cursor-pointer items-center gap-3 text-body">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onPick(o.value)} className="size-6 shrink-0 accent-ink" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Voice, accent, style and speed, with a sample to hear the choice before keeping it. */
export function VoicePicker({ value, onChange, name, voice, mode, progress }: PickerProps) {
  const id = useId();
  const set = (patch: Partial<VoiceChoice>) => onChange(normalizeChoice({ ...value, ...patch }));
  const loading = mode === "loading";
  // A voice's first sample downloads its file, which can take a few seconds.
  const [preparing, setPreparing] = useState(false);
  const playSample = async () => {
    if (!voice || preparing) return;
    setPreparing(true);
    try {
      await voice.sample(sampleText(name), { voice: voiceId(value), speed: speedValue(value) });
    } finally {
      setPreparing(false);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <Choice legend="Voice" name={`${id}-gender`} options={GENDERS} value={value.gender} onPick={(gender) => set({ gender })} />
      <Choice legend="Accent" name={`${id}-accent`} options={ACCENTS} value={value.accent} onPick={(accent) => set({ accent })} />
      <Choice legend="Style" name={`${id}-style`} options={stylesFor(value.gender, value.accent)} value={value.style} onPick={(style) => set({ style })} />
      <Choice legend="Speed" name={`${id}-speed`} options={SPEEDS} value={value.speed} onPick={(speed) => set({ speed })} />
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={loading || !voice}
          // Not disabled while preparing: that would drop a keyboard user's focus.
          aria-disabled={preparing || undefined}
          onClick={() => void playSample()}
          className={`${secondaryButton} self-start aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
        >
          {loading ? `Voice loading, ${progress}%` : preparing ? "Preparing sample" : "Play a sample"}
        </button>
        {value.gender === "male" && <p className={hint}>{MALE_NOTE}</p>}
        {mode === "basic" && <p className={hint}>Your device&apos;s voice will be used, and it may not match this choice.</p>}
      </div>
    </div>
  );
}

export function VoiceScreen({ initial, name, voice, mode, progress, onSave, onCancel }: Omit<PickerProps, "value" | "onChange"> & { initial: VoiceChoice; onSave: (v: VoiceChoice) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section aria-labelledby="voice-heading" className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id="voice-heading" ref={headingRef} tabIndex={-1} className="text-caption font-bold text-balance">
          Your voice
        </h2>
        <p className="text-body text-muted">Replies are spoken in this voice.</p>
      </div>
      <VoicePicker value={value} onChange={setValue} name={name} voice={voice} mode={mode} progress={progress} />
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={primaryButton}
          onClick={() => {
            voice?.stop();
            onSave(value);
          }}
        >
          Save
        </button>
        <button
          type="button"
          className={secondaryButton}
          onClick={() => {
            voice?.stop();
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
