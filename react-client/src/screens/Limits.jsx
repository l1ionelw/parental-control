import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import DevicePicker from '../components/DevicePicker'
import { AppsGrid, Calendar, ChevronDown, Lock, Plus, Spinner, Trash } from '../components/Icons'

function minutesToInputValue(totalMinutes) {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function inputValueToMinutes(value) {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

function formatClock(totalMinutes) {
  const h24 = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const suffix = h24 < 12 ? 'AM' : 'PM'
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

function formatLimit(minutes) {
  if (minutes == null) return 'No limit'
  if (minutes === 0) return 'Blocked'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m / day`
  if (m === 0) return `${h}h / day`
  return `${h}h ${m}m / day`
}

export default function Limits({ devices, selectedId, onSelectDevice, user, onLogout }) {
  const isAdmin = user?.type === 'Administrator'

  const [apps, setApps] = useState([])
  const [limits, setLimits] = useState([])
  const [downtimes, setDowntimes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openAppId, setOpenAppId] = useState(null)

  // App catalog is device-independent - fetch once.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { apps } = await api.apps()
        if (alive) setApps(apps)
      } catch (err) {
        if (!alive) return
        if (err.status === 401) return onLogout()
        setError(err.message)
      }
    })()
    return () => {
      alive = false
    }
    // onLogout is a fresh function identity every render (see useLogout) - fetch
    // once per mount instead of depending on it, or this refetches forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedId) return
    let alive = true
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const [limitsRes, downtimeRes] = await Promise.all([
          api.limits(selectedId),
          api.downtimes(selectedId),
        ])
        if (!alive) return
        setLimits(limitsRes.limits)
        setDowntimes(downtimeRes.downtimes)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const limitByAppId = useMemo(() => {
    const map = new Map()
    for (const l of limits) map.set(l.appId, l)
    return map
  }, [limits])

  async function saveLimit(appId, dailyLimitMinutes) {
    const { limit } = await api.setLimit(selectedId, appId, dailyLimitMinutes)
    setLimits((prev) => {
      const rest = prev.filter((l) => l.appId !== appId)
      return limit ? [...rest, limit] : rest
    })
  }

  async function addDowntime(next) {
    const { downtime } = await api.addDowntime(selectedId, next.startMinute, next.endMinute, next.enabled)
    setDowntimes((prev) => [...prev, downtime].sort((a, b) => a.startMinute - b.startMinute))
  }

  async function editDowntime(id, next) {
    const { downtime } = await api.updateDowntime(id, next.startMinute, next.endMinute, next.enabled)
    setDowntimes((prev) =>
      prev.map((d) => (d.id === id ? downtime : d)).sort((a, b) => a.startMinute - b.startMinute)
    )
  }

  async function removeDowntime(id) {
    await api.deleteDowntime(id)
    setDowntimes((prev) => prev.filter((d) => d.id !== id))
  }

  return (
    <div className="anim-float-in">
      <div className="flex items-end justify-between mb-3">
        <div>
          <h1 className="text-[1.5rem] font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Limits
          </h1>
          <p className="text-[0.9rem] text-slate-500 dark:text-slate-400">
            {isAdmin
              ? 'Set daily app limits and downtime for a device.'
              : 'View daily app limits and downtime for a device.'}
          </p>
        </div>
        {!isAdmin && (
          <span className="flex items-center gap-1.5 text-[0.72rem] font-bold uppercase tracking-wide text-slate-400 bg-slate-100 dark:bg-white/[0.06] rounded-full px-3 py-1.5 shrink-0">
            <Lock width={12} height={12} />
            Read only
          </span>
        )}
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
        <EmptyState text="Pick a device to see its limits." />
      ) : (
        <>
          <DowntimeSection
            downtimes={downtimes}
            isAdmin={isAdmin}
            onAdd={addDowntime}
            onEdit={editDowntime}
            onRemove={removeDowntime}
          />

          <h3 className="mt-7 mb-3 text-[0.8rem] font-bold uppercase tracking-wide text-slate-400 pl-1">
            App limits
          </h3>
          {apps.length === 0 ? (
            <EmptyState text="No applications tracked yet." />
          ) : (
            <div className="rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm overflow-hidden">
              {apps.map((app, i) => (
                <AppLimitRow
                  key={app.id}
                  app={app}
                  limit={limitByAppId.get(app.id) || null}
                  isAdmin={isAdmin}
                  open={openAppId === app.id}
                  onToggle={() => setOpenAppId((id) => (id === app.id ? null : app.id))}
                  onSave={(minutes) => saveLimit(app.id, minutes)}
                  isLast={i === apps.length - 1}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DowntimeSection({ downtimes, isAdmin, onAdd, onEdit, onRemove }) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 grid place-items-center rounded-xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
            <Calendar width={18} height={18} />
          </div>
          <div className="font-semibold text-slate-800 dark:text-slate-200">Downtime windows</div>
        </div>
        {isAdmin && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-[0.82rem] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 focus-ring rounded px-2 py-1"
          >
            <Plus width={14} height={14} />
            Add
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {downtimes.length === 0 && !adding && (
          <div className="text-[0.85rem] text-slate-500 dark:text-slate-400">No downtime windows set.</div>
        )}
        {downtimes.map((d) => (
          <DowntimeRow
            key={d.id}
            downtime={d}
            isAdmin={isAdmin}
            onSave={(next) => onEdit(d.id, next)}
            onRemove={() => onRemove(d.id)}
          />
        ))}
        {adding && (
          <DowntimeRow
            isAdmin={isAdmin}
            startInEdit
            onSave={async (next) => {
              await onAdd(next)
              setAdding(false)
            }}
            onCancelNew={() => setAdding(false)}
          />
        )}
      </div>
    </div>
  )
}

function DowntimeRow({ downtime, isAdmin, startInEdit, onSave, onRemove, onCancelNew }) {
  const isNew = !downtime
  const [editing, setEditing] = useState(!!startInEdit)
  const [draft, setDraft] = useState(
    downtime || { startMinute: 22 * 60, endMinute: 7 * 60, enabled: true }
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  function startEdit() {
    setDraft(downtime)
    setErr('')
    setEditing(true)
  }

  async function submit() {
    setSaving(true)
    setErr('')
    try {
      await onSave(draft)
      setEditing(false)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 bg-slate-50 dark:bg-white/[0.04]">
        <div className="text-[0.88rem] text-slate-700 dark:text-slate-300">
          {!downtime.enabled && (
            <span className="text-slate-400 dark:text-slate-500 font-medium">(disabled) </span>
          )}
          {formatClock(downtime.startMinute)} – {formatClock(downtime.endMinute)}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={startEdit}
              className="text-[0.8rem] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 focus-ring rounded px-2 py-1"
            >
              Edit
            </button>
            <button
              onClick={onRemove}
              title="Delete"
              className="w-7 h-7 grid place-items-center rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition focus-ring"
            >
              <Trash width={14} height={14} />
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl px-3 py-3 bg-slate-50 dark:bg-white/[0.04] anim-pop-in">
      <div className="flex flex-wrap items-center gap-3">
        <TimeField
          label="Starts"
          value={minutesToInputValue(draft.startMinute)}
          onChange={(v) => setDraft((d) => ({ ...d, startMinute: inputValueToMinutes(v) }))}
        />
        <TimeField
          label="Ends"
          value={minutesToInputValue(draft.endMinute)}
          onChange={(v) => setDraft((d) => ({ ...d, endMinute: inputValueToMinutes(v) }))}
        />
        <label className="flex items-center gap-2 text-[0.85rem] font-medium text-slate-700 dark:text-slate-300 mt-4">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
            className="w-4 h-4 accent-indigo-600"
          />
          Enabled
        </label>
      </div>

      {err && <div className="mt-3 text-[0.82rem] font-medium text-rose-600 dark:text-rose-400">{err}</div>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={saving}
          className="h-9 px-4 rounded-xl font-semibold text-white text-[0.85rem] bg-gradient-to-br from-violet-600 to-indigo-600 transition active:scale-[0.98] disabled:opacity-70 focus-ring flex items-center gap-2"
        >
          {saving && <Spinner width={14} height={14} />}
          Save
        </button>
        <button
          onClick={() => (isNew ? onCancelNew() : setEditing(false))}
          disabled={saving}
          className="h-9 px-4 rounded-xl font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] text-[0.85rem] transition focus-ring"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function TimeField({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.72rem] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 px-3 rounded-xl bg-slate-50 dark:bg-white/[0.06] border border-slate-200 dark:border-white/[0.08] text-[0.9rem] text-slate-900 dark:text-slate-100 focus-ring"
      />
    </label>
  )
}

function AppLimitRow({ app, limit, isAdmin, open, onToggle, onSave, isLast }) {
  const [hours, setHours] = useState(0)
  const [minutes, setMinutes] = useState(0)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (open) {
      const total = limit?.dailyLimitMinutes ?? 0
      setHours(Math.floor(total / 60))
      setMinutes(total % 60)
      setErr('')
    }
  }, [open, limit])

  async function submit() {
    setSaving(true)
    setErr('')
    try {
      await onSave(hours * 60 + minutes)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    setSaving(true)
    setErr('')
    try {
      await onSave(null)
    } catch (e) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={isLast ? '' : 'border-b border-black/[0.05] dark:border-white/[0.06]'}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50/60 dark:hover:bg-white/[0.03] transition"
      >
        <div className="w-9 h-9 shrink-0 grid place-items-center rounded-xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
          <AppsGrid width={16} height={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[0.88rem] font-semibold text-slate-800 dark:text-slate-200 truncate">
            {app.exeName}
          </div>
          <div className="text-[0.8rem] text-slate-500 dark:text-slate-400 truncate">
            {app.fileDescription || '—'}
          </div>
        </div>
        <div
          className={`shrink-0 text-[0.82rem] font-semibold ${
            limit ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400'
          }`}
        >
          {formatLimit(limit?.dailyLimitMinutes)}
        </div>
        <ChevronDown
          width={16}
          height={16}
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-5 pb-4 anim-pop-in">
          {isAdmin ? (
            <div className="flex flex-wrap items-end gap-3 pl-12">
              <NumberField label="Hours" value={hours} max={23} onChange={setHours} />
              <NumberField label="Minutes" value={minutes} max={59} onChange={setMinutes} />

              {err && <div className="text-[0.8rem] font-medium text-rose-600 dark:text-rose-400 w-full">{err}</div>}

              <button
                onClick={submit}
                disabled={saving}
                className="h-9 px-4 rounded-xl font-semibold text-white text-[0.85rem] bg-gradient-to-br from-violet-600 to-indigo-600 transition active:scale-[0.98] disabled:opacity-70 focus-ring flex items-center gap-2"
              >
                {saving && <Spinner width={14} height={14} />}
                Save
              </button>
              {limit && (
                <button
                  onClick={clear}
                  disabled={saving}
                  className="h-9 px-4 rounded-xl font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] text-[0.85rem] transition focus-ring"
                >
                  Clear limit
                </button>
              )}
            </div>
          ) : (
            <div className="pl-12 text-[0.85rem] text-slate-500 dark:text-slate-400">
              {limit ? `${formatLimit(limit.dailyLimitMinutes)} set by an administrator.` : 'No limit set.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NumberField({ label, value, max, onChange }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[0.72rem] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))}
        className="h-10 w-20 px-3 rounded-xl bg-slate-50 dark:bg-white/[0.06] border border-slate-200 dark:border-white/[0.08] text-[0.9rem] text-slate-900 dark:text-slate-100 focus-ring"
      />
    </label>
  )
}

function EmptyState({ text }) {
  return (
    <div className="mt-2 rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm px-6 py-12 text-center anim-float-in">
      <div className="mx-auto w-14 h-14 grid place-items-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
        <Lock width={26} height={26} />
      </div>
      <p className="mt-4 text-[0.9rem] text-slate-500 dark:text-slate-400 max-w-[320px] mx-auto">{text}</p>
    </div>
  )
}

function LoadingCard() {
  return (
    <div className="mt-2 h-16 rounded-2xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm flex items-center justify-center gap-2 text-slate-400">
      <Spinner width={18} height={18} />
      <span className="text-sm font-medium">Loading limits…</span>
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
