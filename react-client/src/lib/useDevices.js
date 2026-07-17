import { useEffect, useState } from 'react'
import { api } from './api'

// Shared by every page that needs the device list + a selected device, since each
// route now fetches its own data instead of sharing a parent's state via Outlet.
export function useDevices(onLogout) {
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
        if (err.status === 401) return onLogout()
        setError(err.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
    // Fetch once per mount - onLogout is a fresh function identity on every render
    // (see useLogout), so depending on it here would refetch/loop forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { devices, selectedId, setSelectedId, loading, error }
}
