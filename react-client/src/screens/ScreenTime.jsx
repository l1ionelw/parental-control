import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import DevicePicker from '../components/DevicePicker'
import { Activity, ChevronDown, Globe, LayoutGrid, Spinner } from '../components/Icons'

// Executable names recognized as browsers for the "which browser was actually in
// the foreground" filter (see BrowserPicker) - only apps we can plausibly attribute
// tab-focus time to, matched case-insensitively against /api/screentime's exeName.
// No ".exe" suffix here - app_tracker.py stores exeName without the extension.
const BROWSER_EXE_NAMES = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi']

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

// Best-effort hostname for grouping - falls back to the raw string for
// non-http(s) URLs (chrome://, file://, malformed) rather than dropping the row.
function domainOf(url) {
  try {
    return new URL(url).hostname || url || 'Unknown'
  } catch {
    return url || 'Unknown'
  }
}

function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged = []
  for (const iv of sorted) {
    const last = merged[merged.length - 1]
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end)
    } else {
      merged.push({ ...iv })
    }
  }
  return merged
}

// Clips each website event to the portions that overlap an active interval -
// i.e. "only count this tab as screen time while the browser itself was actually
// in the foreground", correcting for the fact that a tab-switch event's whole
// startTime->endTime span assumes the browser stayed foregrounded the entire time.
function clipEventsToActive(events, activeIntervals) {
  if (!activeIntervals.length) return []
  const out = []
  for (const e of events) {
    for (const iv of activeIntervals) {
      const start = Math.max(e.startTime, iv.start)
      const end = Math.min(e.endTime, iv.end)
      if (start < end) out.push({ ...e, startTime: start, endTime: end })
    }
  }
  return out
}

function useScreenTimeData(selectedId, date, mode, onLogout) {
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
        const fn = mode === 'browser' ? api.websiteHistory : api.screentime
        const { events } = await fn(selectedId, startTime, endTime)
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
  }, [selectedId, date, mode])

  return { events, loading, error }
}

// App-usage events for the same range, used only to know when a given browser
// process was actually in the foreground (see BrowserPicker / clipEventsToActive).
function useAppEvents(selectedId, date, enabled) {
  const [appEvents, setAppEvents] = useState([])

  useEffect(() => {
    if (!enabled || !selectedId) return
    let alive = true
    const [startTime, endTime] = dayRangeMs(date)
    ;(async () => {
      try {
        const { events } = await api.screentime(selectedId, startTime, endTime)
        if (alive) setAppEvents(events)
      } catch {
        if (alive) setAppEvents([])
      }
    })()
    return () => {
      alive = false
    }
  }, [selectedId, date, enabled])

  return appEvents
}

// mode is 'apps' | 'browser' - driven by which route rendered this component
// (see ScreenTimePage / BrowserScreenTimePage), not local state, so each is its
// own linkable/bookmarkable URL instead of a client-side-only toggle.
export default function ScreenTime({ devices, selectedId, onSelectDevice, onLogout, mode }) {
  const [date, setDate] = useState(todayInputValue)
  const [browserFilter, setBrowserFilter] = useState(null)
  const [expandedDomains, setExpandedDomains] = useState(() => new Set())
  const { events, loading, error } = useScreenTimeData(selectedId, date, mode, onLogout)
  const appEvents = useAppEvents(selectedId, date, mode === 'browser')

  // Reset the filter/expansion state whenever the underlying scope changes so a
  // stale browser pick or expanded row from a different day/device doesn't linger.
  useEffect(() => {
    setBrowserFilter(null)
    setExpandedDomains(new Set())
  }, [selectedId, date, mode])

  const browserOptions = useMemo(() => {
    const seen = new Set()
    for (const e of appEvents) {
      if (e.exeName && BROWSER_EXE_NAMES.includes(e.exeName.toLowerCase())) seen.add(e.exeName)
    }
    return [...seen]
  }, [appEvents])

  const activeIntervals = useMemo(() => {
    if (!browserFilter) return []
    return mergeIntervals(
      appEvents
        .filter((e) => e.exeName === browserFilter)
        .map((e) => ({ start: e.startTime, end: e.endTime }))
    )
  }, [appEvents, browserFilter])

  // The events actually charted/listed: raw tab events in apps mode, or in browser
  // mode only once a browser is picked - clipped to that browser's foreground time.
  const displayEvents = useMemo(() => {
    if (mode !== 'browser') return events
    if (!browserFilter) return []
    return clipEventsToActive(events, activeIntervals)
  }, [events, mode, browserFilter, activeIntervals])

  const needsBrowserPick = mode === 'browser' && !browserFilter

  // Attributes each session's whole duration to the hour it started in - the
  // simplification the server also uses (see /api/screentime docstring).
  const hourly = useMemo(() => {
    const buckets = new Array(24).fill(0)
    for (const e of displayEvents) {
      const hour = new Date(e.startTime).getHours()
      buckets[hour] += e.endTime - e.startTime
    }
    return buckets
  }, [displayEvents])

  // Browser mode groups by domain first (collapsible), then by exact URL beneath -
  // grouping by full tabUrl at the top level fragmented every distinct path/query
  // string of the same site into its own row, which read as "grouped by title".
  const domainRows = useMemo(() => {
    if (mode !== 'browser') return []
    const domains = new Map()
    for (const e of displayEvents) {
      const domain = domainOf(e.tabUrl)
      const duration = e.endTime - e.startTime

      let d = domains.get(domain)
      if (!d) {
        d = { domain, durationMs: 0, paths: new Map(), isCurrent: false }
        domains.set(domain, d)
      }
      d.durationMs += duration
      if (e.current) d.isCurrent = true

      let p = d.paths.get(e.tabUrl)
      if (!p) {
        p = { key: e.tabUrl, url: e.tabUrl, title: e.tabTitle || e.tabUrl, durationMs: 0, isCurrent: false }
        d.paths.set(e.tabUrl, p)
      }
      p.durationMs += duration
      if (e.current) p.isCurrent = true
    }
    return [...domains.values()]
      .map((d) => ({ ...d, paths: [...d.paths.values()].sort((a, b) => b.durationMs - a.durationMs) }))
      .sort((a, b) => b.durationMs - a.durationMs)
  }, [displayEvents, mode])

  const appRows = useMemo(() => {
    if (mode === 'browser') return []
    const totals = new Map()
    for (const e of displayEvents) {
      const key = e.appId
      const duration = e.endTime - e.startTime
      const entry = totals.get(key)
      if (entry) {
        entry.durationMs += duration
        if (e.current) entry.isCurrent = true
      } else {
        totals.set(key, {
          key,
          label: e.exeName || 'unknown',
          sublabel: e.fileDescription,
          durationMs: duration,
          isCurrent: !!e.current,
        })
      }
    }
    return [...totals.values()].sort((a, b) => b.durationMs - a.durationMs)
  }, [displayEvents, mode])

  // The server injects a synthetic 'current: true' event covering "now" for
  // whatever app is currently focused (see /api/screentime) - surfaced here as
  // its own banner rather than only folded into appRows, so it's visible even
  // when e.g. the day's total is otherwise 0.
  const currentApp = useMemo(
    () => (mode === 'apps' ? displayEvents.find((e) => e.current) : null),
    [displayEvents, mode]
  )

  // Same idea for the browser side - the server patches the still-open tab's
  // WebsiteEvent row up to "now" (see /api/website-history), and clipEventsToActive
  // preserves the 'current' flag through clamping, so this is only non-null once
  // the selected browser is actually the foreground app right now (see activeIntervals).
  const currentTab = useMemo(
    () => (mode === 'browser' ? displayEvents.find((e) => e.current) : null),
    [displayEvents, mode]
  )

  const totalMs = useMemo(() => displayEvents.reduce((sum, e) => sum + (e.endTime - e.startTime), 0), [displayEvents])
  const maxHourMs = Math.max(1, ...hourly)
  const maxRowMs = Math.max(1, ...appRows.map((r) => r.durationMs), ...domainRows.map((r) => r.durationMs))

  function toggleDomain(domain) {
    setExpandedDomains((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }

  return (
    <div className="anim-float-in">
      <div className="flex items-end justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h1 className="text-[1.5rem] font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Screen Time
          </h1>
          <p className="text-[0.9rem] text-slate-500 dark:text-slate-400">
            Usage by hour and by app or website for the selected day.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ModeTabs mode={mode} />
          <input
            type="date"
            value={date}
            max={todayInputValue()}
            onChange={(e) => setDate(e.target.value)}
            className="h-10 px-3 rounded-xl bg-white dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-[0.88rem] font-medium text-slate-800 dark:text-slate-200 focus-ring"
          />
        </div>
      </div>

      {devices.length > 0 && (
        <div className="mb-4">
          <DevicePicker devices={devices} selectedId={selectedId} onSelect={onSelectDevice} />
        </div>
      )}

      {mode === 'browser' && selectedId && !loading && (
        <div className="mb-4">
          <BrowserPicker options={browserOptions} selected={browserFilter} onSelect={setBrowserFilter} />
        </div>
      )}

      {currentApp && (
        <div className="mb-4 flex items-center gap-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-4 py-3">
          <span className="w-2 h-2 rounded-full bg-emerald-500 anim-pulse shrink-0" />
          <span className="text-[0.85rem] text-emerald-800 dark:text-emerald-400">
            Currently using{' '}
            <span className="font-mono font-semibold">{currentApp.exeName}</span>
            {currentApp.fileDescription ? ` (${currentApp.fileDescription})` : ''}
          </span>
        </div>
      )}

      {currentTab && (
        <div className="mb-4 flex items-center gap-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-4 py-3">
          <span className="w-2 h-2 rounded-full bg-emerald-500 anim-pulse shrink-0" />
          <span className="text-[0.85rem] text-emerald-800 dark:text-emerald-400 truncate">
            Currently browsing{' '}
            <span className="font-semibold">{domainOf(currentTab.tabUrl)}</span>
          </span>
        </div>
      )}

      {loading ? (
        <LoadingCard />
      ) : error ? (
        <ErrorCard message={error} />
      ) : !selectedId ? (
        <EmptyState text="Pick a device to see its screen time." />
      ) : needsBrowserPick ? (
        <EmptyState text="Pick a browser above to see tab activity filtered to only the time that browser was actually in the foreground." />
      ) : displayEvents.length === 0 ? (
        <EmptyState
          text={
            mode === 'browser'
              ? `No tab activity overlapped with ${browserFilter} being in the foreground on this day.`
              : 'No app usage recorded for this day.'
          }
        />
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
            {mode === 'browser' ? 'By website, most to least' : 'By application, most to least'}
          </h3>

          {mode === 'browser' ? (
            <div className="rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm p-2 sm:p-3">
              {domainRows.map((row) => {
                const expanded = expandedDomains.has(row.domain)
                const multiPath = row.paths.length > 1
                return (
                  <div key={row.domain}>
                    <button
                      type="button"
                      onClick={() => multiPath && toggleDomain(row.domain)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left ${
                        multiPath ? 'hover:bg-slate-50 dark:hover:bg-white/[0.06] cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      <div className="w-4 shrink-0 text-slate-400">
                        {multiPath && (
                          <ChevronDown
                            width={16}
                            height={16}
                            className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
                          />
                        )}
                      </div>
                      <div className="w-[120px] sm:w-[160px] shrink-0 text-[0.85rem] font-medium text-slate-700 dark:text-slate-300 truncate flex items-center gap-1.5">
                        {row.isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pulse shrink-0" />}
                        <span className="truncate">{row.domain}</span>
                      </div>
                      <div className="flex-1 h-5 rounded-full bg-slate-100 dark:bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                          style={{ width: `${Math.max(2, (row.durationMs / maxRowMs) * 100)}%` }}
                        />
                      </div>
                      <div className="w-[64px] shrink-0 text-right text-[0.82rem] font-semibold text-slate-600 dark:text-slate-400 tabular-nums">
                        {formatDuration(row.durationMs)}
                      </div>
                    </button>

                    {expanded && (
                      <div className="ml-7 mb-1.5 border-l border-black/[0.06] dark:border-white/[0.08] pl-3">
                        {row.paths.map((p) => (
                          <div key={p.key} className="flex items-center gap-3 py-1.5">
                            <div className="flex-1 min-w-0">
                              <div className="text-[0.8rem] font-medium text-slate-600 dark:text-slate-300 truncate">
                                {p.title}
                              </div>
                              <div className="text-[0.72rem] text-slate-400 truncate">{p.url}</div>
                            </div>
                            <div className="w-[64px] shrink-0 text-right text-[0.76rem] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                              {formatDuration(p.durationMs)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm p-2 sm:p-3">
              {appRows.map((row) => (
                <div key={row.key} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-[120px] sm:w-[160px] shrink-0 text-[0.85rem] font-medium text-slate-700 dark:text-slate-300 truncate flex items-center gap-1.5">
                    {row.isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pulse shrink-0" />}
                    <span className="font-mono">{row.label}</span>
                  </div>
                  <div className="flex-1 h-5 rounded-full bg-slate-100 dark:bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                      style={{ width: `${Math.max(2, (row.durationMs / maxRowMs) * 100)}%` }}
                    />
                  </div>
                  <div className="w-[64px] shrink-0 text-right text-[0.82rem] font-semibold text-slate-600 dark:text-slate-400 tabular-nums">
                    {formatDuration(row.durationMs)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ModeTabs({ mode }) {
  return (
    <div className="grid grid-cols-2 p-1 rounded-xl bg-white dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08]">
      <Link
        to="/screentime"
        className={`flex items-center gap-1.5 px-3 h-9 rounded-lg text-[0.82rem] font-semibold transition ${
          mode === 'apps'
            ? 'bg-slate-100 dark:bg-white/[0.1] text-slate-900 dark:text-slate-100'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
        }`}
      >
        <LayoutGrid width={16} height={16} />
        Apps
      </Link>
      <Link
        to="/screentime/browser"
        className={`flex items-center gap-1.5 px-3 h-9 rounded-lg text-[0.82rem] font-semibold transition ${
          mode === 'browser'
            ? 'bg-slate-100 dark:bg-white/[0.1] text-slate-900 dark:text-slate-100'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
        }`}
      >
        <Globe width={16} height={16} />
        Browser
      </Link>
    </div>
  )
}

// Pill selector for "which browser process's foreground time should tab activity
// be filtered to" - see clipEventsToActive. Plain buttons (not DevicePicker-style
// dropdown) since there are at most a handful of options.
function BrowserPicker({ options, selected, onSelect }) {
  if (options.length === 0) {
    return (
      <div className="rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20 text-amber-800 dark:text-amber-400 px-4 py-3 text-[0.85rem] font-medium">
        No browser data for this day.
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[0.8rem] font-semibold text-slate-500 dark:text-slate-400">Filter by browser:</span>
      {options.map((exeName) => (
        <button
          key={exeName}
          type="button"
          onClick={() => onSelect(exeName)}
          className={`h-8 px-3 rounded-lg text-[0.82rem] font-semibold transition border ${
            selected === exeName
              ? 'bg-indigo-50 dark:bg-indigo-500/15 border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-400'
              : 'bg-white dark:bg-white/[0.04] border-black/[0.06] dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.08]'
          }`}
        >
          {exeName}
        </button>
      ))}
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
