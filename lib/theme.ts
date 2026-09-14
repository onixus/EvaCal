export const THEME_STORAGE_KEY = 'evacal-theme';

export type Theme = 'light' | 'dark';

export function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(THEME_STORAGE_KEY);
  return value === 'light' || value === 'dark' ? value : null;
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
  root.classList.toggle('dark', theme === 'dark');
  // Остатки снятой темы Dark Fantasy в старых сессиях: класс и атрибут больше
  // ничего не стилизуют, но пусть и не висят на корне.
  root.classList.remove('dark-fantasy');
  root.removeAttribute('data-theme');
  window.dispatchEvent(new CustomEvent('evacal-theme-change', { detail: { theme } }));
}

// Runs before hydration (inlined in <head>) so the page never flashes the wrong theme:
// an explicit user choice in localStorage wins, otherwise falls back to the OS preference.
// A stored value from the retired Dark Fantasy theme is read as plain dark.
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=s==='dark'||s==='dark-fantasy'?true:s==='light'?false:window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);document.documentElement.classList.remove('dark-fantasy');document.documentElement.removeAttribute('data-theme');}catch(e){}})();`;
