"use client";

import { CaretDown, GearSix } from "@phosphor-icons/react";
import type { ThemeChoice } from "@/lib/settings";

const THEME_LABELS: Record<ThemeChoice, string> = {
  system: "Match this device",
  light: "Light",
  dark: "Dark",
  contrast: "High contrast",
};

const SHORTCUTS: [string, string][] = [
  ["1, 2, 3", "Speak a reply (when you're not in a text box)"],
  ["Alt+1, Alt+2", "Send a quick reaction"],
  ["Enter", "Speak what you typed"],
  ["Up arrow", "Move from the text box to the replies"],
  ["Esc", "Stop speaking, or clear the text box"],
];

interface Props {
  theme: ThemeChoice;
  digitKeys: boolean;
  cloudCaptions: boolean;
  onTheme: (theme: ThemeChoice) => void;
  onDigitKeys: (on: boolean) => void;
  onCloudCaptions: (on: boolean) => void;
}

export function SettingsPanel({ theme, digitKeys, cloudCaptions, onTheme, onDigitKeys, onCloudCaptions }: Props) {
  return (
    <details className="group rounded-control border-2 border-ink/30">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-control px-4 text-body font-bold [&::-webkit-details-marker]:hidden">
        <GearSix aria-hidden="true" size={22} />
        Settings
        <CaretDown aria-hidden="true" size={18} className="ml-auto transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-6 px-4 pt-2 pb-5">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-label font-bold">Theme</legend>
          {(Object.keys(THEME_LABELS) as ThemeChoice[]).map((t) => (
            <label key={t} className="flex min-h-12 cursor-pointer items-center gap-3 text-body">
              <input
                type="radio"
                name="theme"
                value={t}
                checked={theme === t}
                onChange={() => onTheme(t)}
                className="size-6 shrink-0 accent-ink"
              />
              {THEME_LABELS[t]}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1">
          <label className="flex min-h-12 cursor-pointer items-center gap-3 text-body">
            <input
              type="checkbox"
              checked={digitKeys}
              onChange={(e) => onDigitKeys(e.target.checked)}
              aria-describedby="digit-keys-hint"
              className="size-6 shrink-0 accent-ink"
            />
            Number keys speak replies
          </label>
          <p id="digit-keys-hint" className="text-label text-muted">
            Turn this off if you use voice control, so saying a number doesn&apos;t speak a reply.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex min-h-12 cursor-pointer items-center gap-3 text-body">
            <input
              type="checkbox"
              checked={cloudCaptions}
              onChange={(e) => onCloudCaptions(e.target.checked)}
              aria-describedby="cloud-captions-hint"
              className="size-6 shrink-0 accent-ink"
            />
            Clearer captions
          </label>
          <p id="cloud-captions-hint" className="text-label text-muted">
            When the other person finishes speaking, their words are sent to Deepgram, through Cloudflare, for a more accurate caption.
            OnBeat doesn&apos;t keep the audio. If the service is busy, the caption from this device is used.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-label font-bold">Keyboard shortcuts</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-label">
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys} className="contents">
                <dt className="font-bold whitespace-nowrap">{keys}</dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </details>
  );
}
