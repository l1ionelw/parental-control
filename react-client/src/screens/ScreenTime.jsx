import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import DevicePicker from '../components/DevicePicker'
import { Activity, Spinner } from '../components/Icons'

function todayInputValue() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Local midnight -> local midnight of the next day, both inclusive per the
// server's `startTime BETWEEN startOfDay AND endOfDay` query.
function dayRangeMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end = new Date(y, m - 1, d, 23, 59, 59, 999)
  return [start.getTime(), end.getTime()]
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return '0s'
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatHour(hour) {
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}${hour < 12 ? 'a' : 'p'}`
}

export default function ScreenTime({ devices, selectedId, onSelectDevice, onLogout }) {
  const [date, setDate] = useState(todayInputValue)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!selectedId) return
    let alive = true
    setLoading(true)
    setError('')
    const [startTime, endTime] = dayRangeMs(date)
    ;(async () => {
      try {
        const { events } = await api.screentime(selectedId, startTime, endTime)
        if (!alive) return
        setEvents(events)
      } catch (err) {
        if (!alive) return
        if (err.status === 401) return onLogout()
        setError(err.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
    // onLogout is a fresh function identity every render (see useLogout) - depend
    // only on the values that should actually retrigger the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, date])

  // Attributes each session's whole duration to the hour it started in - the
  // simplification the server also uses (see /api/screentime docstring).
  const hourly = useMemo(() => {
    const buckets = new Array(24).fill(0)
    for (const e of events) {
      const hour = new Date(e.startTime).getHours()
      buckets[hour] += e.endTime - e.startTime
    }
    return buckets
  }, [events])

  const byApp = useMemo(() => {
    const totals = new Map()
    for (const e of events) {
      const key = e.appId
      const duration = e.endTime - e.startTime
      const entry = totals.get(key)
      if (entry) {
        entry.durationMs += duration
      } else {
        totals.set(key, {
          appId: key,
          exeName: e.exeName || 'unknown',
          fileDescription: e.fileDescription,
          durationMs: duration,
        })
      }
    }
    return [...totals.values()].sort((a, b) => b.durationMs - a.durationMs)
  }, [events])

  const totalMs = useMemo(() => events.reduce((sum, e) => sum + (e.endTime - e.startTime), 0), [events])
  const maxHourMs = Math.max(1, ...hourly)
  const maxAppMs = Math.max(1, ...byApp.map((a) => a.durationMs))

  return (
    <div className="anim-float-in">
      <div className="flex items-end justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h1 className="text-[1.5rem] font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Screen Time
          </h1>
          <p className="text-[0.9rem] text-slate-500 dark:text-slate-400">
            Usage by hour and by app for the selected day.
          </p>
        </div>
        <input
          type="date"
          value={date}
          max={todayInputValue()}
          onChange={(e) => setDate(e.target.value)}
          className="h-10 px-3 rounded-xl bg-white dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-[0.88rem] font-medium text-slate-800 dark:text-slate-200 focus-ring"
        />
      </div>

      {devices.length > 0 && (
        <div className="mb-4">
          <DevicePicker devices={devices} selectedId={selectedId} onSelect={onSelectDevice} />
        </div>
      )}

      {loading ? (
        <LoadingCard />
      ) : error ? (
        <ErrorCard message={error} />
      ) : !selectedId ? (
        <EmptyState text="Pick a device to see its screen time." />
      ) : events.length === 0 ? (
        <EmptyState text="No usage recorded for this day." />
      ) : (
        <>
          <div className="rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm p-5 sm:p-6">
            <div className="flex items-baseline justify-between mb-5">
              <span className="text-[0.78rem] font-bold uppercase tracking-wide text-slate-400">
                Total time
              </span>
              <span className="text-[1.3rem] font-bold text-slate-900 dark:text-slate-100">
                {formatDuration(totalMs)}
              </span>
            </div>

            {/* Hourly usage - one series (minutes used), so no legend is needed. */}
            <div className="flex items-end gap-[3px] h-32">
              {hourly.map((ms, hour) => (
                <div
                  key={hour}
                  className="flex-1 min-w-0 flex flex-col items-center justify-end h-full group relative"
                  title={`${formatHour(hour)} · ${formatDuration(ms)}`}
                >
                  <div
                    className="w-full rounded-t-[4px] bg-indigo-500 dark:bg-indigo-400 opacity-80 group-hover:opacity-100 transition"
                    style={{ height: `${ms > 0 ? Math.max(2, (ms / maxHourMs) * 100) : 0}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex text-[0.65rem] font-medium text-slate-400">
              {hourly.map((_, hour) => (
                <div key={hour} className="flex-1 text-center">
                  {hour % 3 === 0 ? formatHour(hour) : ''}
                </div>
              ))}
            </div>
          </div>

          <h3 className="mt-7 mb-3 text-[0.8rem] font-bold uppercase tracking-wide text-slate-400 pl-1">
            By application, most to least
          </h3>
          <div className="rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm p-2 sm:p-3">
            {byApp.map((app) => (
              <div key={app.appId} className="flex items-center gap-3 px-3 py-2.5">
                <div className="w-[120px] sm:w-[160px] shrink-0 text-[0.85rem] font-medium text-slate-700 dark:text-slate-300 truncate font-mono">
                  {app.exeName}
                </div>
                <div className="flex-1 h-5 rounded-full bg-slate-100 dark:bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                    style={{ width: `${Math.max(2, (app.durationMs / maxAppMs) * 100)}%` }}
                  />
                </div>
                <div className="w-[64px] shrink-0 text-right text-[0.82rem] font-semibold text-slate-600 dark:text-slate-400 tabular-nums">
                  {formatDuration(app.durationMs)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function EmptyState({ text }) {
  return (
    <div className="mt-2 rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm px-6 py-12 text-center anim-float-in">
      <div className="mx-auto w-14 h-14 grid place-items-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
        <Activity width={26} height={26} />
      </div>
      <p className="mt-4 text-[0.9rem] text-slate-500 dark:text-slate-400 max-w-[320px] mx-auto">{text}</p>
    </div>
  )
}

function LoadingCard() {
  return (
    <div className="mt-2 h-16 rounded-2xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm flex items-center justify-center gap-2 text-slate-400">
      <Spinner width={18} height={18} />
      <span className="text-sm font-medium">Loading usage…</span>
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
