import { useState } from 'react'
import { api, setSession } from '../lib/api'
import { clearApiUrl, getApiUrl } from '../lib/apiConfig'
import { useTheme } from '../lib/useTheme'
import Logo from '../components/Logo'
import ThemeToggle from '../components/ThemeToggle'
import { Spinner } from '../components/Icons'

export default function Auth({ onAuthed }) {
  const [theme, toggleTheme] = useTheme()
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isRegister = mode === 'register'

  async function submit(e) {
    e.preventDefault()
    if (loading) return
    setError('')
    setLoading(true)
    try {
      const fn = isRegister ? api.register : api.login
      const { token, user } = await fn(username.trim(), password)
      setSession(token, user)
      onAuthed()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function switchMode(next) {
    setMode(next)
    setError('')
  }

  function changeServer() {
    clearApiUrl()
    window.location.reload()
  }

  return (
    <div className="min-h-full grid place-items-center px-5 py-10 relative">
      <div className="absolute top-5 right-5">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>

      <div className="w-full max-w-[400px] anim-float-in">
        <div className="flex flex-col items-center text-center mb-7">
          <Logo size={46} />
<h1 className="mt-4 text-[1.7rem] font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {isRegister ? 'Create your Parental Controls' : 'Welcome back'}
            </h1>
            <p className="mt-1.5 text-[0.95rem] text-slate-500 dark:text-slate-400">
              {isRegister
                ? 'Parental controls, quietly handled.'
                : 'Sign in to manage your family\'s devices.'}
            </p>
        </div>

        <div className="rounded-[26px] bg-white/85 dark:bg-slate-900/70 backdrop-blur border border-black/[0.06] dark:border-white/[0.08] shadow-[0_20px_50px_-24px_rgba(79,70,229,0.35)] p-6 sm:p-7">
          {/* Segmented mode toggle */}
          <div className="grid grid-cols-2 p-1 mb-6 rounded-2xl bg-slate-100 dark:bg-white/[0.06]">
            {['login', 'register'].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`h-9 rounded-xl text-sm font-semibold transition-all focus-ring ${
                  mode === m
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {m === 'login' ? 'Sign in' : 'Sign up'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Username">
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="you@family"
                required
                className="w-full h-11 px-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.06] border border-slate-200 dark:border-white/[0.08] text-[0.95rem] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus-ring transition"
              />
            </Field>

            <Field label="Password">
              <input
                type="password"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full h-11 px-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.06] border border-slate-200 dark:border-white/[0.08] text-[0.95rem] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus-ring transition"
              />
            </Field>

            {error && (
              <div className="anim-pop-in text-[0.85rem] font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 rounded-xl px-3.5 py-2.5">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 h-11 rounded-xl font-semibold text-white text-[0.95rem] bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-indigo-600/25 transition active:scale-[0.98] hover:brightness-[1.05] disabled:opacity-70 disabled:active:scale-100 focus-ring flex items-center justify-center gap-2"
            >
              {loading && <Spinner width={18} height={18} />}
              {isRegister ? 'Create account' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-[0.85rem] text-slate-500 dark:text-slate-400">
          {isRegister ? 'Already have an account?' : 'New to Parental Controls?'}{' '}
          <button
            onClick={() => switchMode(isRegister ? 'login' : 'register')}
            className="font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 focus-ring rounded"
          >
            {isRegister ? 'Sign in' : 'Create one'}
          </button>
        </p>

        <p className="mt-2 text-center text-[0.78rem] text-slate-400 dark:text-slate-500">
          Server: <span className="font-medium">{getApiUrl()}</span>{' '}
          <button
            onClick={changeServer}
            className="font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 focus-ring rounded"
          >
            Change
          </button>
        </p>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.8rem] font-semibold text-slate-600 dark:text-slate-400 pl-0.5">{label}</span>
      {children}
    </label>
  )
}
