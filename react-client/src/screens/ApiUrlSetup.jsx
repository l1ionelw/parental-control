import { useState } from 'react'
import { normalizeApiUrl, pingApiUrl, setApiUrl } from '../lib/apiConfig'
import { useTheme } from '../lib/useTheme'
import Logo from '../components/Logo'
import ThemeToggle from '../components/ThemeToggle'
import { Spinner } from '../components/Icons'

export default function ApiUrlSetup({ onSaved }) {
  const [theme, toggleTheme] = useTheme()
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [unreachableUrl, setUnreachableUrl] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setError('')
    setUnreachableUrl(null)

    const normalized = normalizeApiUrl(value)
    if (!normalized) {
      setError('Enter a full URL, including http:// or https://')
      return
    }

    setChecking(true)
    const reachable = await pingApiUrl(normalized)
    setChecking(false)

    if (reachable) {
      commit(normalized)
    } else {
      setUnreachableUrl(normalized)
    }
  }

  function commit(url) {
    setApiUrl(url)
    onSaved(url)
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
            Connect to your server
          </h1>
          <p className="mt-1.5 text-[0.95rem] text-slate-500 dark:text-slate-400">
            Enter the address of your Parental Controls server.
          </p>
        </div>

        <div className="rounded-[26px] bg-white/85 dark:bg-slate-900/70 backdrop-blur border border-black/[0.06] dark:border-white/[0.08] shadow-[0_20px_50px_-24px_rgba(79,70,229,0.35)] p-6 sm:p-7">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[0.8rem] font-semibold text-slate-600 dark:text-slate-400 pl-0.5">
                Server URL
              </span>
              <input
                type="text"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value)
                  setUnreachableUrl(null)
                }}
                placeholder="http://192.168.1.32"
                required
                autoFocus
                className="w-full h-11 px-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.06] border border-slate-200 dark:border-white/[0.08] text-[0.95rem] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus-ring transition"
              />
            </label>

            {error && (
              <div className="anim-pop-in text-[0.85rem] font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 rounded-xl px-3.5 py-2.5">
                {error}
              </div>
            )}

            {unreachableUrl && (
              <div className="anim-pop-in flex flex-col gap-2.5 text-[0.85rem] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 rounded-xl px-3.5 py-3">
                <span>
                  Couldn't reach {unreachableUrl}. It might be offline, or the address might be wrong.
                </span>
                <button
                  type="button"
                  onClick={() => commit(unreachableUrl)}
                  className="self-start font-semibold underline underline-offset-2 hover:no-underline focus-ring rounded"
                >
                  Continue anyway
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={checking}
              className="mt-1 h-11 rounded-xl font-semibold text-white text-[0.95rem] bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-indigo-600/25 transition active:scale-[0.98] hover:brightness-[1.05] disabled:opacity-70 disabled:active:scale-100 focus-ring flex items-center justify-center gap-2"
            >
              {checking && <Spinner width={18} height={18} />}
              {checking ? 'Checking…' : 'Continue'}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-[0.82rem] text-slate-500 dark:text-slate-400">
          You can change this later from the sign-in screen.
        </p>
      </div>
    </div>
  )
}
