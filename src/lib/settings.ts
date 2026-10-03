/**
 * Display, keyboard and caption settings, kept in localStorage. The theme key is also
 * read by the script in layout.tsx before first paint.
 */

export const THEMES = ["system", "light", "dark", "contrast"] as const;
export type ThemeChoice = (typeof THEMES)[number];

export interface Settings {
  theme: ThemeChoice;
  digitKeys: boolean;
  /** Send the other person's finished lines to Deepgram Nova-3 for more accurate captions. On unless the user turns it off. */
  cloudCaptions: boolean;
  /** Suggest notes from conversations. On unless the user turns it off. */
  learning: boolean;
  /** When the other person pauses for a moment and carries on, their words stay in one line. On unless the user turns it off. */
  joinLines: boolean;
}

const THEME_KEY = "onbeat:theme";
const DIGIT_KEYS_KEY = "onbeat:digit-keys";
const CLOUD_CAPTIONS_KEY = "onbeat:cloud-captions";
const LEARNING_KEY = "onbeat:learning";
const LEARNING_TOLD_KEY = "onbeat:learning-told";
const JOIN_LINES_KEY = "onbeat:join-lines";

let current: Settings | null = null;
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Storage can be blocked (private windows, site settings); the choice still holds for this page. */
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

export function getSettings(): Settings {
  if (!current) {
    const theme = read(THEME_KEY);
    current = {
      theme: THEMES.includes(theme as ThemeChoice) ? (theme as ThemeChoice) : "system",
      digitKeys: read(DIGIT_KEYS_KEY) !== "off",
      // Earlier versions saved "on" when it was turned on; that still reads as on.
      cloudCaptions: read(CLOUD_CAPTIONS_KEY) !== "off",
      learning: read(LEARNING_KEY) !== "off",
      joinLines: read(JOIN_LINES_KEY) !== "off",
    };
  }
  return current;
}

const SERVER_SETTINGS: Settings = { theme: "system", digitKeys: true, cloudCaptions: true, learning: true, joinLines: true };
export const getServerSettings = (): Settings => SERVER_SETTINGS;

export function subscribeSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function update(patch: Partial<Settings>) {
  current = { ...getSettings(), ...patch };
  listeners.forEach((cb) => cb());
}

export function setTheme(theme: ThemeChoice) {
  write(THEME_KEY, theme === "system" ? null : theme);
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  update({ theme });
}

export function setDigitKeys(on: boolean) {
  write(DIGIT_KEYS_KEY, on ? null : "off");
  update({ digitKeys: on });
}

export function setCloudCaptions(on: boolean) {
  write(CLOUD_CAPTIONS_KEY, on ? null : "off");
  update({ cloudCaptions: on });
}

export function setLearning(on: boolean) {
  write(LEARNING_KEY, on ? null : "off");
  update({ learning: on });
}

export function setJoinLines(on: boolean) {
  write(JOIN_LINES_KEY, on ? null : "off");
  update({ joinLines: on });
}

/** Set once the user has been told notes are suggested; holds for this page even when storage is blocked. */
let toldThisPage = false;

export function learningTold(): boolean {
  return toldThisPage || read(LEARNING_TOLD_KEY) === "yes";
}

export function markLearningTold() {
  toldThisPage = true;
  write(LEARNING_TOLD_KEY, "yes");
}

/** Drops the cached settings so the next read comes from storage. For tests. */
export function forgetSettings() {
  current = null;
  toldThisPage = false;
}
