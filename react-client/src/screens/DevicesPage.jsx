import { Link } from 'react-router-dom'
import TopBar from '../components/TopBar'
import DevicePicker from '../components/DevicePicker'
import { getUser } from '../lib/api'
import { useDevices } from '../lib/useDevices'
import { useLogout } from '../lib/useLogout'
import { useTheme } from '../lib/useTheme'
import { Monitor, Clock, AppsGrid, Calendar, Activity, Spinner } from '../components/Icons'

export default function DevicesPage() {
  const user = getUser()
  const onLogout = useLogout()
  const [theme, toggleTheme] = useTheme()
  const { devices, selectedId, setSelectedId, loading, error } = useDevices(onLogout)

  const selected = devices.find((d) => d.id === selectedId) || null
  const isAdmin = user?.type === 'Administrator'

  return (
    <div className="min-h-full flex flex-col">
      <TopBar user={user} theme={theme} onToggleTheme={toggleTheme} onLogout={onLogout} />

      <main className="flex-1 w-full max-w-[680px] mx-auto px-5 pt-8 pb-16">
        <div className="anim-float-in">
          <div className="flex items-end justify-between mb-3">
            <div>
              <h1 className="text-[1.5rem] font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Devices
              </h1>
              <p className="text-[0.9rem] text-slate-500 dark:text-slate-400">
                Choose a device to manage its protections.
              </p>
            </div>
            {!loading && devices.length > 0 && (
              <span className="text-[0.8rem] font-semibold text-slate-500 dark:text-slate-400 bg-white dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] rounded-full px-3 py-1">
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
              {selected && <DeviceDetail device={selected} isAdmin={isAdmin} />}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function DeviceDetail({ device, isAdmin }) {
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
      <div className="rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm p-5 sm:p-6">
        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
          <span className="w-2 h-2 rounded-full bg-emerald-500 anim-pulse" />
          <span className="text-[0.78rem] font-bold uppercase tracking-wide">Linked</span>
        </div>
        <h2 className="mt-2 text-[1.35rem] font-bold text-slate-900 dark:text-slate-100">
          {device.deviceName}
        </h2>

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
        <ControlTile to="/screentime" icon={Clock} label="Screen Time" hint="Daily limits" />
        <ControlTile to="/limits" icon={AppsGrid} label="App Limits" hint="Per-app caps" />
        <ControlTile to="/limits" icon={Calendar} label="Schedule" hint="Downtime & bedtime" />
        <ControlTile to="/screentime/browser" icon={Activity} label="Activity" hint="Browser usage" />
        {isAdmin && (
          <ControlTile
            to="/screenshare"
            icon={Monitor}
            label="Screen Share"
            hint="Watch live feed"
          />
        )}
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
      <dd className={`mt-0.5 text-[0.92rem] text-slate-800 dark:text-slate-200 truncate ${mono ? 'font-mono' : ''}`}>
        {value || '—'}
      </dd>
    </div>
  )
}

function ControlTile({ to, icon: Icon, label, hint }) {
  return (
    <Link
      to={to}
      className="group relative rounded-2xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] p-4 overflow-hidden hover:shadow-md hover:border-black/[0.1] dark:hover:border-white/[0.14] transition focus-ring"
    >
      <div className="w-10 h-10 grid place-items-center rounded-xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
        <Icon />
      </div>
      <div className="mt-3 font-semibold text-slate-800 dark:text-slate-200">{label}</div>
      <div className="text-[0.82rem] text-slate-500 dark:text-slate-400">{hint}</div>
    </Link>
  )
}

function EmptyState() {
  return (
    <div className="mt-2 rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm px-6 py-12 text-center anim-float-in">
      <div className="mx-auto w-14 h-14 grid place-items-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
        <Monitor width={26} height={26} />
      </div>
      <h2 className="mt-4 text-[1.1rem] font-bold text-slate-900 dark:text-slate-100">No devices yet</h2>
      <p className="mt-1.5 text-[0.9rem] text-slate-500 dark:text-slate-400 max-w-[320px] mx-auto">
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
    <div className="mt-2 h-16 rounded-2xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm flex items-center justify-center gap-2 text-slate-400">
      <Spinner width={18} height={18} />
      <span className="text-sm font-medium">Loading devices…</span>
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
