/**
 * Display and keyboard settings, kept in localStorage. The theme key is also
 * read by the script in layout.tsx before first paint.
 */

export const THEMES = ["system", "light", "dark", "contrast"] as const;
export type ThemeChoice = (typeof THEMES)[number];

export interface Settings {
  theme: ThemeChoice;
  digitKeys: boolean;
}

const THEME_KEY = "onbeat:theme";
const DIGIT_KEYS_KEY = "onbeat:digit-keys";

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
    };
  }
  return current;
}

const SERVER_SETTINGS: Settings = { theme: "system", digitKeys: true };
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

/** Drops the cached settings so the next read comes from storage. For tests. */
export function forgetSettings() {
  current = null;
}
