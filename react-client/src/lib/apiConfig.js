// The server's base URL is set once (see screens/ApiUrlSetup.jsx) and persisted
// here, rather than assuming same-origin/relative paths - so behavior is
// identical in dev and in any self-hosted deployment, no proxy required.
const API_URL_KEY = 'haven_api_url'

export function getApiUrl() {
  return localStorage.getItem(API_URL_KEY)
}

export function setApiUrl(url) {
  localStorage.setItem(API_URL_KEY, url)
}

export function clearApiUrl() {
  localStorage.removeItem(API_URL_KEY)
}

// Validates + normalizes a user-entered server URL. Does NOT assume a port -
// whatever the user typed (or omitted) is used as-is, matching however their
// server is actually exposed (reverse proxy on 80/443, raw Flask on 5002, etc).
// Returns null if invalid.
export function normalizeApiUrl(raw) {
  const trimmed = (raw || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) return null

  try {
    return new URL(trimmed).origin
  } catch {
    return null
  }
}

// GET /api/health with a short timeout - used to warn (not block) if the entered
// URL doesn't seem reachable before committing to it.
export async function pingApiUrl(apiUrl, timeoutMs = 4000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${apiUrl}/api/health`, { signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
