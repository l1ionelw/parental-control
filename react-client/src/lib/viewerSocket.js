// Thin wrapper around the /ws/viewer connection (see server/viewer_ws.py).
// Auth happens on the handshake (the same JWT used for the REST API); watch_device
// is sent right after it, once the socket is actually open - sending it any
// earlier (e.g. synchronously after `new WebSocket(...)`) silently no-ops
// because the socket is still CONNECTING, so the server just waits forever.
import { getToken } from './api'
import { getApiUrl } from './apiConfig'

export function connectViewerSocket(deviceUserId, { onFrame, onWatching, onClose }) {
  const apiUrl = new URL(getApiUrl())
  const proto = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${proto}//${apiUrl.host}/ws/viewer`)

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'handshake', token: getToken() }))
    ws.send(JSON.stringify({ type: 'watch_device', deviceUserId }))
  }

  ws.onmessage = (event) => {
    let data
    try {
      data = JSON.parse(event.data)
    } catch {
      return
    }

    if (data.type === 'stream_frame') {
      onFrame?.(data.frame)
    } else if (data.type === 'watching') {
      onWatching?.(data.deviceUserId, data.online)
    }
  }

  ws.onclose = () => onClose?.()

  return {
    stopWatching: () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop_watching' }))
    },
    close: () => ws.close(),
  }
}
