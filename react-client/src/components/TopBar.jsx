import { Link, useLocation } from 'react-router-dom'
import Logo from './Logo'
import ThemeToggle from './ThemeToggle'
import { LogOut } from './Icons'

const NAV_ITEMS = [
  { to: '/devices', label: 'Devices' },
  { to: '/apps', label: 'Apps' },
  { to: '/screentime', label: 'Screen Time' },
  { to: '/limits', label: 'Limits' },
]

export default function TopBar({ user, theme, onToggleTheme, onLogout }) {
  const { pathname } = useLocation()
  const isAdmin = user?.type === 'Administrator'

  return (
    <header className="sticky top-0 z-10 backdrop-blur bg-white/70 dark:bg-slate-950/70 border-b border-black/[0.05] dark:border-white/[0.06]">
      <div className="max-w-[680px] mx-auto px-5 h-16 flex items-center justify-between gap-3">
        <Logo size={30} withWordmark />
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-[0.85rem] font-semibold text-slate-800 dark:text-slate-100">
              {user?.username}
            </span>
            <span
              className={`text-[0.68rem] font-bold uppercase tracking-wide ${
                isAdmin ? 'text-violet-600 dark:text-violet-400' : 'text-slate-400'
              }`}
            >
              {user?.type}
            </span>
          </div>
          <div className="w-9 h-9 grid place-items-center rounded-full font-bold text-white text-sm bg-gradient-to-br from-violet-500 to-indigo-500 shrink-0">
            {(user?.username || '?').charAt(0).toUpperCase()}
          </div>
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button
            onClick={onLogout}
            title="Sign out"
            className="w-9 h-9 shrink-0 grid place-items-center rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-white/10 transition focus-ring"
          >
            <LogOut />
          </button>
        </div>
      </div>
      <nav className="max-w-[680px] mx-auto px-5 pb-2.5 -mt-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} active={pathname === item.to}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}

function NavLink({ to, active, children }) {
  return (
    <Link
      to={to}
      className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-[0.85rem] font-medium transition ${
        active
          ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300'
          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/[0.06]'
      }`}
    >
      {children}
    </Link>
  )
}
