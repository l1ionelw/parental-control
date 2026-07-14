// Thin API client. Talks to the Flask /api blueprint (proxied by Vite in dev).
// The JWT + user are persisted in localStorage so a refresh keeps you signed in.

const BASE = '/api'
const TOKEN_KEY = 'haven_token'
const USER_KEY = 'haven_user'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY))
  } catch {
    return null
  }
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Cannot reach the server. Is it running on port 5002?')
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  register: (username, password) =>
    request('/register', { method: 'POST', body: { username, password } }),
  login: (username, password) =>
    request('/login', { method: 'POST', body: { username, password } }),
  devices: () => request('/devices', { auth: true }),
}
