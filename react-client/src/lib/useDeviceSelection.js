import { useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

// Keeps the selected device in the URL's `device` query param instead of
// component state, so it survives navigating between routes that share the
// same picker (e.g. /screentime <-> /screentime/browser) - the ModeTabs
// links in ScreenTime.jsx carry it along, so switching from Apps to Browser
// screen time for a device no longer resets back to the first device.
export function useDeviceSelection(devices) {
  const [searchParams, setSearchParams] = useSearchParams()

  const raw = searchParams.get('device')
  const selectedId = raw !== null && !Number.isNaN(Number(raw)) ? Number(raw) : null

  const setSelectedId = useCallback(
    (id) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('device', String(id))
          return next
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  // Default to the first device once the list loads, if the URL didn't
  // already name one (or named one that doesn't exist, e.g. a stale link).
  useEffect(() => {
    if (!devices.length) return
    if (selectedId !== null && devices.some((d) => d.id === selectedId)) return
    setSelectedId(devices[0].id)
    // Only re-run when the device list or current selection changes - setSelectedId
    // is stable (useCallback), including it would just be noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, selectedId])

  return { selectedId, setSelectedId }
}
