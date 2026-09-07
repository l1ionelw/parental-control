import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { AppsGrid, Spinner } from '../components/Icons'

export default function Apps({ onLogout }) {
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { apps } = await api.apps()
        if (!alive) return
        setApps(apps)
      } catch (err) {
        if (!alive) return
        if (err.status === 401) return onLogout()
        setError(err.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
    // onLogout is a fresh function identity every render (see useLogout) - fetch
    // once per mount instead of depending on it, or this refetches forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="anim-float-in">
      <div className="flex items-end justify-between mb-3">
        <div>
          <h1 className="text-[1.5rem] font-bold tracking-tight text-slate-900 dark:text-slate-100">Applications</h1>
          <p className="text-[0.9rem] text-slate-500 dark:text-slate-400">
            Every executable the system has ever tracked.
          </p>
        </div>
        {!loading && apps.length > 0 && (
          <span className="text-[0.8rem] font-semibold text-slate-500 dark:text-slate-400 bg-white dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] rounded-full px-3 py-1">
            {apps.length} known
          </span>
        )}
      </div>

      {loading ? (
        <LoadingCard />
      ) : error ? (
        <ErrorCard message={error} />
      ) : apps.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-black/[0.05] dark:border-white/[0.08] whitespace-nowrap">
                <Th>Executable</Th>
                <Th>Description</Th>
                <Th className="w-[26%]">Normalized Path</Th>
                <Th className="w-[34%]">Raw Paths</Th>
              </tr>
            </thead>
            <tbody>
              {apps.map((app, i) => (
                <tr
                  key={app.id}
                  className="border-b border-black/[0.03] dark:border-white/[0.05] last:border-0 transition hover:bg-slate-50/60 dark:hover:bg-white/[0.04] align-top"
                >
                  <td className="px-5 py-3 text-[0.92rem] font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                    <span className="font-mono text-[0.85rem]">{app.exeName}</span>
                  </td>
                  <td className="px-5 py-3 text-[0.88rem] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    {app.fileDescription || '—'}
                  </td>
                  <td className="px-5 py-3 text-[0.84rem] text-slate-500 dark:text-slate-400 font-mono break-all">
                    {app.path || '—'}
                  </td>
                  <td className="px-5 py-3 text-[0.84rem] text-slate-500 dark:text-slate-400 font-mono">
                    {app.allPaths && app.allPaths.length > 0 ? (
                      <div className="max-h-[110px] overflow-y-auto flex flex-col gap-1 pr-1">
                        {app.allPaths.map((p, j) => (
                          <div key={j} className="break-all leading-snug">
                            {p}
                          </div>
                        ))}
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({ children, className }) {
  return (
    <th className={`px-5 py-2.5 text-[0.72rem] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 ${className ?? ''}`}>
      {children}
    </th>
  )
}

function EmptyState() {
  return (
    <div className="mt-2 rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm px-6 py-12 text-center anim-float-in">
      <div className="mx-auto w-14 h-14 grid place-items-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
        <AppsGrid width={26} height={26} />
      </div>
      <h2 className="mt-4 text-[1.1rem] font-bold text-slate-900 dark:text-slate-100">No applications yet</h2>
      <p className="mt-1.5 text-[0.9rem] text-slate-500 dark:text-slate-400 max-w-[320px] mx-auto">
        Tracked apps will show up here once a device starts sending usage data.
      </p>
    </div>
  )
}

function LoadingCard() {
  return (
    <div className="mt-2 h-16 rounded-2xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm flex items-center justify-center gap-2 text-slate-400">
      <Spinner width={18} height={18} />
      <span className="text-sm font-medium">Loading applications…</span>
    </div>
  )
}

function ErrorCard({ message }) {
  return (
    <div className="mt-2 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 text-rose-700 dark:text-rose-400 px-4 py-3.5 text-sm font-medium">
      {message}
    </div>
  )
}
