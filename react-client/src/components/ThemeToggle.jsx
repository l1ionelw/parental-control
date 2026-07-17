import { Sun, Moon } from './Icons'

export default function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={onToggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="w-9 h-9 grid place-items-center rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-white/10 transition focus-ring"
    >
      {isDark ? <Sun width={18} height={18} /> : <Moon width={18} height={18} />}
    </button>
  )
}
