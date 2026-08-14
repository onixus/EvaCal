export const THEME_STORAGE_KEY = 'evacal-theme';

export type Theme = 'light' | 'dark' | 'dark-fantasy';

export function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(THEME_STORAGE_KEY);
  return value === 'light' || value === 'dark' || value === 'dark-fantasy' ? value : null;
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(): Theme {
  return getStoredTheme() ?? (systemPrefersDark() ? 'dark' : 'light');
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark-fantasy') {
    root.classList.add('dark', 'dark-fantasy');
    root.setAttribute('data-theme', 'dark-fantasy');
  } else if (theme === 'dark') {
    root.classList.add('dark');
    root.classList.remove('dark-fantasy');
    root.removeAttribute('data-theme');
  } else {
    root.classList.remove('dark', 'dark-fantasy');
    root.removeAttribute('data-theme');
  }
  window.dispatchEvent(new CustomEvent('evacal-theme-change', { detail: { theme } }));
}

// Runs before hydration (inlined in <head>) so the page never flashes the wrong theme:
// an explicit user choice in localStorage wins, otherwise falls back to the OS preference.
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(s==='dark-fantasy'){document.documentElement.classList.add('dark','dark-fantasy');document.documentElement.setAttribute('data-theme','dark-fantasy');}else if(s==='dark'){document.documentElement.classList.add('dark');document.documentElement.classList.remove('dark-fantasy');document.documentElement.removeAttribute('data-theme');}else if(s==='light'){document.documentElement.classList.remove('dark','dark-fantasy');document.documentElement.removeAttribute('data-theme');}else{var dark=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',dark);}}catch(e){}})();`;
