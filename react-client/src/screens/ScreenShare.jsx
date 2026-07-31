import { useEffect, useRef, useState } from 'react'
import { connectViewerSocket } from '../lib/viewerSocket'
import { Maximize, Minimize, Monitor, Spinner } from '../components/Icons'

export default function ScreenShare({ devices }) {
  const [watching, setWatching] = useState(null) // { id, deviceName } | null
  const [online, setOnline] = useState(null) // null = waiting on ack, true/false after
  const [frameSrcs, setFrameSrcs] = useState({}) // screen index -> data URL
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
    setFrameSrcs({})
    setOnline(null)
    setWatching({ id: device.id, deviceName: device.deviceName })

    socketRef.current = connectViewerSocket(device.id, {
      onFrame: (base64, screenIndex) =>
        setFrameSrcs((prev) => ({ ...prev, [screenIndex]: `data:image/jpeg;base64,${base64}` })),
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
    setFrameSrcs({})
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
          frameSrcs={frameSrcs}
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

function WatchingView({ deviceName, online, frameSrcs, onStop }) {
  // Screens announce themselves by frame index as they arrive, so until the
  // first frame lands we don't know the monitor count yet - show one waiting
  // tile in that case rather than nothing.
  const screenIndices = Object.keys(frameSrcs).map(Number).sort((a, b) => a - b)
  const tiles = screenIndices.length > 0 ? screenIndices : [0]

  const containerRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // 'combined' shows every display tiled as large as it can be inside the
  // fullscreen area; a number pins the view to just that screen index.
  const [view, setView] = useState('combined')

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  // If the picked display disappears (e.g. the device reconnects with fewer
  // monitors), fall back to the combined view instead of showing a blank tile.
  useEffect(() => {
    if (view !== 'combined' && !tiles.includes(view)) setView('combined')
  }, [tiles, view])

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      containerRef.current?.requestFullscreen()
    }
  }

  const visibleTiles = view === 'combined' ? tiles : [view]
  const showPerTileLabels = view === 'combined' && tiles.length > 1

  return (
    <div className="anim-pop-in">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[0.9rem] font-semibold text-slate-700 dark:text-slate-300">
          Watching {deviceName}
          {tiles.length > 1 && (
            <span className="ml-2 text-[0.78rem] font-medium text-slate-400">
              {tiles.length} screens
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="h-9 w-9 grid place-items-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition focus-ring"
            title="Fullscreen"
          >
            <Maximize width={16} height={16} />
          </button>
          <button
            onClick={onStop}
            className="h-9 px-4 rounded-xl font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06] text-[0.85rem] transition focus-ring"
          >
            Stop
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={
          isFullscreen
            ? 'w-screen h-screen bg-black flex flex-col'
            : 'rounded-3xl overflow-hidden'
        }
      >
        {isFullscreen && tiles.length > 1 && (
          <ViewTabs tiles={tiles} view={view} onChange={setView} onExit={toggleFullscreen} />
        )}

        {isFullscreen ? (
          <ScreenGrid
            tiles={visibleTiles}
            frameSrcs={frameSrcs}
            online={online}
            showLabels={showPerTileLabels}
            fill
          />
        ) : (
          <ScreenGrid tiles={tiles} frameSrcs={frameSrcs} online={online} showLabels={tiles.length > 1} />
        )}
      </div>
    </div>
  )
}

// Top bar shown only while fullscreen and there's more than one display -
// lets you pick "Combined" (every screen tiled as large as it can be) or pin
// the view to a single display, without leaving fullscreen to do it.
function ViewTabs({ tiles, view, onChange, onExit }) {
  return (
    <div className="shrink-0 flex items-center justify-between gap-3 px-4 h-12 bg-black/70 backdrop-blur border-b border-white/10">
      <div className="flex items-center gap-1 overflow-x-auto">
        <TabButton active={view === 'combined'} onClick={() => onChange('combined')}>
          Combined
        </TabButton>
        {tiles.map((i) => (
          <TabButton key={i} active={view === i} onClick={() => onChange(i)}>
            Display {i + 1}
          </TabButton>
        ))}
      </div>
      <button
        onClick={onExit}
        title="Exit fullscreen"
        className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition"
      >
        <Minimize width={16} height={16} />
      </button>
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 h-8 px-3 rounded-lg text-[0.8rem] font-semibold transition ${
        active ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white hover:bg-white/[0.08]'
      }`}
    >
      {children}
    </button>
  )
}

// Tiles every given screen index into a grid sized to make each tile as
// large as possible - a near-square layout (cols = ceil(sqrt(n))) reads as
// "one merged view" better than a single row/column would once n > 2.
// `fill` stretches the grid to the full height of its (fullscreen) parent;
// otherwise each tile keeps a 16:9 aspect ratio for the inline preview.
function ScreenGrid({ tiles, frameSrcs, online, showLabels, fill }) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(tiles.length)))

  return (
    <div
      className={fill ? 'flex-1 min-h-0 grid gap-px bg-white/10' : 'grid gap-3'}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {tiles.map((screenIndex) => (
        <ScreenTile
          key={screenIndex}
          label={showLabels ? `Display ${screenIndex + 1}` : null}
          online={online}
          frameSrc={frameSrcs[screenIndex] ?? null}
          fill={fill}
        />
      ))}
    </div>
  )
}

function ScreenTile({ label, online, frameSrc, fill }) {
  return (
    <div
      className={`relative bg-black overflow-hidden grid place-items-center ${
        fill ? 'min-h-0' : 'aspect-video rounded-3xl border border-black/[0.06] dark:border-white/[0.08] shadow-sm'
      }`}
    >
      {label && (
        <span className="absolute top-3 left-3 px-2 py-0.5 rounded-md bg-black/50 text-white text-[0.72rem] font-semibold">
          {label}
        </span>
      )}

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
