import { useEffect, useRef, useState } from 'react'
import { connectViewerSocket } from '../lib/viewerSocket'
import { Maximize, Minimize, Monitor, Spinner } from '../components/Icons'

export default function ScreenShare({ devices }) {
  const [watching, setWatching] = useState(null) // { id, deviceName } | null
  const [online, setOnline] = useState(null) // null = waiting on ack, true/false after
  const [frameSrc, setFrameSrc] = useState(null)
  const socketRef = useRef(null)

  useEffect(() => {
    // Tear down the viewer connection if this screen unmounts mid-watch.
    return () => {
      socketRef.current?.stopWatching()
      socketRef.current?.close()
    }
  }, [])

  function watch(device) {
    socketRef.current?.stopWatching()
    socketRef.current?.close()
    setFrameSrc(null)
    setOnline(null)
    setWatching({ id: device.id, deviceName: device.deviceName })

    socketRef.current = connectViewerSocket(device.id, {
      onFrame: (base64) => setFrameSrc(`data:image/jpeg;base64,${base64}`),
      onWatching: (deviceUserId, isOnline) => {
        if (deviceUserId === device.id) setOnline(isOnline)
      },
      onClose: () => {
        setWatching((w) => (w?.id === device.id ? null : w))
      },
    })
  }

  function stop() {
    socketRef.current?.stopWatching()
    socketRef.current?.close()
    socketRef.current = null
    setWatching(null)
    setOnline(null)
    setFrameSrc(null)
  }

  return (
    <div className="anim-float-in">
      <div className="flex items-end justify-between mb-3">
        <div>
          <h1 className="text-[1.5rem] font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Screen Share
          </h1>
          <p className="text-[0.9rem] text-slate-500 dark:text-slate-400">
            Watch a live low-framerate preview of what a device is doing right now.
          </p>
        </div>
      </div>

      {watching ? (
        <WatchingView
          deviceName={watching.deviceName}
          online={online}
          frameSrc={frameSrc}
          onStop={stop}
        />
      ) : devices.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="rounded-3xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] shadow-sm overflow-hidden">
          {devices.map((d, i) => (
            <div
              key={d.id}
              className={`flex items-center gap-3 px-5 py-3.5 ${
                i === devices.length - 1 ? '' : 'border-b border-black/[0.05] dark:border-white/[0.06]'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  d.isActive ? 'bg-emerald-500 anim-pulse' : 'bg-slate-300 dark:bg-slate-600'
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {d.deviceName}
                </div>
                <div className="text-[0.8rem] text-slate-500 dark:text-slate-400 truncate">
                  {d.osUsername} · {d.isActive ? 'Online' : 'Offline'}
                </div>
              </div>
              <button
                onClick={() => watch(d)}
                disabled={!d.isActive}
                className="h-9 px-4 rounded-xl font-semibold text-white text-[0.85rem] bg-gradient-to-br from-violet-600 to-indigo-600 transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 focus-ring"
              >
                Watch
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WatchingView({ deviceName, online, frameSrc, onStop }) {
  const containerRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      containerRef.current?.requestFullscreen()
    }
  }

  return (
    <div className="anim-pop-in">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[0.9rem] font-semibold text-slate-700 dark:text-slate-300">
          Watching {deviceName}
        </div>
        <button
          onClick={onStop}
          className="h-9 px-4 rounded-xl font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] text-[0.85rem] transition focus-ring"
        >
          Stop
        </button>
      </div>

      <div
        ref={containerRef}
        className={`relative group rounded-3xl bg-black border border-black/[0.06] dark:border-white/[0.08] shadow-sm overflow-hidden grid place-items-center ${
          isFullscreen ? 'w-screen h-screen rounded-none' : 'aspect-video'
        }`}
      >
        {online === false ? (
          <span className="text-[0.9rem] font-medium text-slate-400">Device went offline</span>
        ) : frameSrc ? (
          <img src={frameSrc} alt="" className="w-full h-full object-contain" />
        ) : (
          <span className="flex items-center gap-2 text-[0.9rem] font-medium text-slate-400">
            <Spinner width={18} height={18} />
            Waiting for first frame…
          </span>
        )}

        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          className="absolute bottom-3 right-3 w-9 h-9 grid place-items-center rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
        >
          {isFullscreen ? <Minimize width={16} height={16} /> : <Maximize width={16} height={16} />}
        </button>
      </div>
    </div>
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
        Devices will show up here once they've signed in at least once.
      </p>
    </div>
  )
}
