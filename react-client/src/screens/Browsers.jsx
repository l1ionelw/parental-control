import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import DevicePicker from '../components/DevicePicker'
import { BROWSER_CATALOG } from '../lib/browserCatalog'
import { Lock, ShieldCheck, Spinner } from '../components/Icons'

function setsEqual(a, b) {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

export default function Browsers({ devices, selectedId, onSelectDevice, user, onLogout }) {
  const isAdmin = user?.type === 'Administrator'

  // Both are Sets of BROWSER_CATALOG `id`s that are currently disallowed.
  // savedDisallowedIds mirrors the server; draftDisallowedIds is mutated by
  // checkbox clicks and only reaches the server on Save (unlike Limits.jsx's
  // per-row auto-save, this screen batches everything behind one Save button).
  const [savedDisallowedIds, setSavedDisallowedIds] = useState(new Set())
  const [draftDisallowedIds, setDraftDisallowedIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!selectedId) return
    let alive = true
    setLoading(true)
    setError('')
    ;(async () => {
      try {
        const { browsers } = await api.disallowedBrowsers(selectedId)
        if (!alive) return
        const ids = new Set((browsers || []).map((b) => b.id))
        setSavedDisallowedIds(ids)
        setDraftDisallowedIds(ids)
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

  const dirty = useMemo(
    () => !setsEqual(savedDisallowedIds, draftDisallowedIds),
    [savedDisallowedIds, draftDisallowedIds]
  )

  function toggle(id) {
    setDraftDisallowedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    // Nothing disallowed = every browser allowed.
    setDraftDisallowedIds(new Set())
  }

  function deselectAll() {
    setDraftDisallowedIds(new Set(BROWSER_CATALOG.map((b) => b.id)))
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const browsers = BROWSER_CATALOG.filter((b) => draftDisallowedIds.has(b.id)).map((b) => ({
        id: b.id,
        exeName: b.exeName,
        pathSubstring: b.pathSubstring,
      }))
      await api.setDisallowedBrowsers(selectedId, browsers)
      setSavedDisallowedIds(new Set(draftDisallowedIds))
    } catch (err) {
      if (err.status === 401) return onLogout()
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="anim-float-in">
      <div className="flex items-end justify-between mb-3">
        <div>
          <h1 className="text-[1.5rem] font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Browsers
          </h1>
          <p className="text-[0.9rem] text-slate-500 dark:text-slate-400">
            {isAdmin
              ? 'Choose which browsers are allowed to run on a device.'
              : 'View which browsers are allowed to run on a device.'}
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
        <EmptyState text="Pick a device to see its allowed browsers." />
      ) : (
        <div className="mt-2 rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm overflow-hidden">
          {isAdmin && (
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-black/[0.06] dark:border-white/[0.08]">
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAll}
                  disabled={saving}
                  className="text-[0.8rem] font-semibold text-violet-600 dark:text-violet-400 hover:underline disabled:opacity-50"
                >
                  Select all
                </button>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <button
                  onClick={deselectAll}
                  disabled={saving}
                  className="text-[0.8rem] font-semibold text-violet-600 dark:text-violet-400 hover:underline disabled:opacity-50"
                >
                  Deselect all
                </button>
              </div>
              <button
                onClick={save}
                disabled={!dirty || saving}
                className="flex items-center gap-1.5 text-[0.8rem] font-semibold text-white bg-gradient-to-br from-violet-600 to-indigo-600 rounded-full px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? <Spinner width={14} height={14} /> : <ShieldCheck width={14} height={14} />}
                Save
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 px-5 py-4">
            {BROWSER_CATALOG.map((browser) => (
              <label
                key={browser.id}
                className="flex items-center gap-2 py-1.5 text-[0.85rem] font-medium text-slate-700 dark:text-slate-300"
              >
                <input
                  type="checkbox"
                  checked={!draftDisallowedIds.has(browser.id)}
                  disabled={!isAdmin || saving}
                  onChange={() => toggle(browser.id)}
                  className="w-4 h-4 accent-emerald-600"
                />
                {browser.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState({ text }) {
  return (
    <div className="mt-2 rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm px-6 py-12 text-center anim-float-in">
      <div className="mx-auto w-14 h-14 grid place-items-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
        <ShieldCheck width={26} height={26} />
      </div>
      <p className="mt-4 text-[0.9rem] text-slate-500 dark:text-slate-400 max-w-[320px] mx-auto">{text}</p>
    </div>
  )
}

function LoadingCard() {
  return (
    <div className="mt-2 h-16 rounded-2xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm flex items-center justify-center gap-2 text-slate-400">
      <Spinner width={18} height={18} />
      <span className="text-sm font-medium">Loading browsers…</span>
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
