// Class-based dark mode (see the `dark` custom-variant in index.css). Preference is
// persisted in localStorage; falls back to the OS setting on first visit.

const THEME_KEY = 'haven_theme'

export function getInitialTheme() {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem(THEME_KEY, theme)
}
