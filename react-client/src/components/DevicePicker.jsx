import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from './Icons'

// Custom dropdown (not a native <select>) so we can render a rich row per device.
export default function DevicePicker({ devices, selectedId, onSelect }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = devices.find((d) => d.id === selectedId) || devices[0]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 h-16 pl-3 pr-4 rounded-2xl bg-white border border-black/[0.06] shadow-sm hover:shadow-md transition focus-ring"
      >
        <Avatar name={selected.deviceName} />
        <div className="flex-1 min-w-0 text-left">
          <div className="font-semibold text-slate-900 truncate">{selected.deviceName}</div>
          <div className="text-[0.82rem] text-slate-500 truncate flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
            {selected.osUsername}
          </div>
        </div>
        <ChevronDown
          className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="anim-pop-in absolute z-20 mt-2 w-full rounded-2xl bg-white border border-black/[0.07] shadow-[0_24px_60px_-20px_rgba(15,18,34,0.28)] p-1.5 max-h-[320px] overflow-auto">
          {devices.map((d) => {
            const active = d.id === selected.id
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  onSelect(d.id)
                  setOpen(false)
                }}
                className={`w-full flex items-center gap-3 p-2 rounded-xl text-left transition ${
                  active ? 'bg-indigo-50' : 'hover:bg-slate-50'
                }`}
              >
                <Avatar name={d.deviceName} small />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-900 truncate text-[0.92rem]">
                    {d.deviceName}
                  </div>
                  <div className="text-[0.8rem] text-slate-500 truncate">{d.osUsername}</div>
                </div>
                {active && <Check width={18} height={18} className="text-indigo-600 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Avatar({ name, small }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  const dim = small ? 'w-9 h-9 text-sm' : 'w-11 h-11 text-base'
  return (
    <div
      className={`${dim} shrink-0 grid place-items-center rounded-xl font-bold text-white bg-gradient-to-br from-violet-500 to-indigo-500`}
    >
      {initial}
    </div>
  )
}
