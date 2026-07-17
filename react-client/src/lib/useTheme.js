import { useEffect, useState } from 'react'
import { getInitialTheme, applyTheme } from './theme'

// Each page calls this independently (no shared provider) - applying the same
// class to <html> from multiple call sites is idempotent, so that's fine.
export function useTheme() {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }

  return [theme, toggleTheme]
}
