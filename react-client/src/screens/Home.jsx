import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import Logo from '../components/Logo'
import DevicePicker from '../components/DevicePicker'
import {
  LogOut,
  Monitor,
  Clock,
  AppsGrid,
  Calendar,
  Activity,
  Lock,
  Spinner,
} from '../components/Icons'

export default function Home({ user, onLogout }) {
  const [devices, setDevices] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { devices } = await api.devices()
        if (!alive) return
        setDevices(devices)
        if (devices.length) setSelectedId(devices[0].id)
      } catch (err) {
        if (!alive) return
        if (err.status === 401) return onLogout() // token expired/invalid
        setError(err.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [onLogout])

  const selected = devices.find((d) => d.id === selectedId) || null

  return (
    <div className="min-h-full flex flex-col">
      <TopBar user={user} onLogout={onLogout} />

      <main className="flex-1 w-full max-w-[680px] mx-auto px-5 pt-8 pb-16">
        <div className="anim-float-in">
          <div className="flex items-end justify-between mb-3">
            <div>
              <h1 className="text-[1.5rem] font-bold tracking-tight text-slate-900">Devices</h1>
              <p className="text-[0.9rem] text-slate-500">
                Choose a device to manage its protections.
              </p>
            </div>
            {!loading && devices.length > 0 && (
              <span className="text-[0.8rem] font-semibold text-slate-500 bg-white border border-black/[0.06] rounded-full px-3 py-1">
                {devices.length} linked
              </span>
            )}
          </div>

          {loading ? (
            <LoadingCard />
          ) : error ? (
            <ErrorCard message={error} />
          ) : devices.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <DevicePicker devices={devices} selectedId={selectedId} onSelect={setSelectedId} />
              {selected && <DeviceDetail device={selected} />}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function TopBar({ user, onLogout }) {
  const isAdmin = user?.type === 'Administrator'
  return (
    <header className="sticky top-0 z-10 backdrop-blur bg-white/70 border-b border-black/[0.05]">
      <div className="max-w-[680px] mx-auto px-5 h-16 flex items-center justify-between">
        <Logo size={30} withWordmark />
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-[0.85rem] font-semibold text-slate-800">{user?.username}</span>
            <span
              className={`text-[0.68rem] font-bold uppercase tracking-wide ${
                isAdmin ? 'text-violet-600' : 'text-slate-400'
              }`}
            >
              {user?.type}
            </span>
          </div>
          <div className="w-9 h-9 grid place-items-center rounded-full font-bold text-white text-sm bg-gradient-to-br from-violet-500 to-indigo-500">
            {(user?.username || '?').charAt(0).toUpperCase()}
          </div>
          <button
            onClick={onLogout}
            title="Sign out"
            className="w-9 h-9 grid place-items-center rounded-full text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition focus-ring"
          >
            <LogOut />
          </button>
        </div>
      </div>
    </header>
  )
}

function DeviceDetail({ device }) {
  const added = device.createdAt
    ? new Date(device.createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—'
  const shortId = device.deviceID ? `${device.deviceID.slice(0, 10)}…` : '—'

  return (
    <div className="mt-4 anim-float-in">
      <div className="rounded-3xl bg-white border border-black/[0.06] shadow-sm p-5 sm:p-6">
        <div className="flex items-center gap-2 text-emerald-600">
          <span className="w-2 h-2 rounded-full bg-emerald-500 anim-pulse" />
          <span className="text-[0.78rem] font-bold uppercase tracking-wide">Linked</span>
        </div>
        <h2 className="mt-2 text-[1.35rem] font-bold text-slate-900">{device.deviceName}</h2>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <Meta label="OS account" value={device.osUsername} />
          <Meta label="Added" value={added} />
          <Meta label="Device ID" value={shortId} mono />
        </dl>
      </div>

      <h3 className="mt-7 mb-3 text-[0.8rem] font-bold uppercase tracking-wide text-slate-400 pl-1">
        Controls
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <ControlTile icon={Clock} label="Screen Time" hint="Daily limits" />
        <ControlTile icon={AppsGrid} label="App Limits" hint="Per-app caps" />
        <ControlTile icon={Calendar} label="Schedule" hint="Downtime & bedtime" />
        <ControlTile icon={Activity} label="Activity" hint="Recent usage" />
      </div>
    </div>
  )
}

function Meta({ label, value, mono }) {
  return (
    <div>
      <dt className="text-[0.72rem] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </dt>
      <dd className={`mt-0.5 text-[0.92rem] text-slate-800 truncate ${mono ? 'font-mono' : ''}`}>
        {value || '—'}
      </dd>
    </div>
  )
}

function ControlTile({ icon: Icon, label, hint }) {
  return (
    <div className="group relative rounded-2xl bg-white border border-black/[0.06] p-4 overflow-hidden">
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 grid place-items-center rounded-xl bg-indigo-50 text-indigo-600">
          <Icon />
        </div>
        <span className="flex items-center gap-1 text-[0.68rem] font-bold uppercase tracking-wide text-slate-400 bg-slate-100 rounded-full px-2 py-1">
          <Lock width={12} height={12} />
          Soon
        </span>
      </div>
      <div className="mt-3 font-semibold text-slate-800">{label}</div>
      <div className="text-[0.82rem] text-slate-500">{hint}</div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="mt-2 rounded-3xl bg-white border border-black/[0.06] shadow-sm px-6 py-12 text-center anim-float-in">
      <div className="mx-auto w-14 h-14 grid place-items-center rounded-2xl bg-indigo-50 text-indigo-600">
        <Monitor width={26} height={26} />
      </div>
      <h2 className="mt-4 text-[1.1rem] font-bold text-slate-900">No devices yet</h2>
<p className="mt-1.5 text-[0.9rem] text-slate-500 max-w-[320px] mx-auto">
          Install Parental Controls on a device and sign in — it'll appear here automatically, ready to protect.
        </p>
      <div className="mt-5 inline-flex items-center gap-2 text-[0.82rem] font-medium text-slate-400">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 anim-pulse" />
        Waiting for devices…
      </div>
    </div>
  )
}

function LoadingCard() {
  return (
    <div className="mt-2 h-16 rounded-2xl bg-white border border-black/[0.06] shadow-sm flex items-center justify-center gap-2 text-slate-400">
      <Spinner width={18} height={18} />
      <span className="text-sm font-medium">Loading devices…</span>
    </div>
  )
}

function ErrorCard({ message }) {
  return (
    <div className="mt-2 rounded-2xl bg-rose-50 border border-rose-100 text-rose-700 px-4 py-3.5 text-sm font-medium">
      {message}
    </div>
  )
}
