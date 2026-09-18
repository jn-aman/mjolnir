import { create } from 'zustand';

export type ThemeChoice = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'mjolnir.theme';

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function stored(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'dark' || value === 'light' || value === 'system') return value;
  } catch {
    // Private windows and blocked site data both throw here. A missing
    // preference is not an error; it just means we fall back to the default.
  }
  return 'system';
}

function apply(resolved: ResolvedTheme): void {
  document.documentElement.dataset['theme'] = resolved;
}

interface ThemeStore {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  set(choice: ThemeChoice): void;
}

export const useTheme = create<ThemeStore>((set) => {
  const choice = stored();
  const resolved = choice === 'system' ? systemTheme() : choice;
  apply(resolved);

  // Follow the OS while the choice is "system", and stop the moment it is not.
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      set((state) => {
        if (state.choice !== 'system') return state;
        const next = systemTheme();
        apply(next);
        return { ...state, resolved: next };
      });
    });
  }

  return {
    choice,
    resolved,
    set(next) {
      const nextResolved = next === 'system' ? systemTheme() : next;
      apply(nextResolved);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // The preference is a convenience; failing to persist it must never
        // stop the theme from changing for this session.
      }
      set({ choice: next, resolved: nextResolved });
    },
  };
});
