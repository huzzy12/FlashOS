/** Theme engine — swaps design tokens, persists choice, announces changes. */

import type { Bus, ThemeName } from './events';

const STORAGE_KEY = 'flashos.theme';
const THEMES: readonly ThemeName[] = ['flash', 'light', 'synthwave'];

export interface ThemeEngine {
  get(): ThemeName;
  set(theme: ThemeName): void;
  cycle(): void;
  all(): readonly ThemeName[];
  label(theme: ThemeName): string;
}

function isThemeName(value: string | null): value is ThemeName {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

export function createTheme(bus: Bus): ThemeEngine {
  const stored = localStorage.getItem(STORAGE_KEY);
  let current: ThemeName = isThemeName(stored) ? stored : 'flash';
  document.documentElement.dataset.theme = current;

  const labels: Record<ThemeName, string> = {
    flash: 'Flash',
    light: 'Light',
    synthwave: 'Synthwave'
  };

  return {
    get: () => current,
    set(theme) {
      if (theme === current) return;
      current = theme;
      document.documentElement.dataset.theme = theme;
      localStorage.setItem(STORAGE_KEY, theme);
      bus.emit('theme:changed', theme);
    },
    cycle() {
      const idx = THEMES.indexOf(current);
      const next = THEMES[(idx + 1) % THEMES.length];
      if (next) this.set(next);
    },
    all: () => THEMES,
    label: (theme) => labels[theme]
  };
}
