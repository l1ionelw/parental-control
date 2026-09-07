// Thin API client. Talks to the Flask /api blueprint at whatever server URL was
// configured in ApiUrlSetup - same behavior in dev and in any deployment, no
// proxy or same-origin assumption.
// The JWT + user are persisted in localStorage so a refresh keeps you signed in.

import { getApiUrl } from './apiConfig'

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
    res = await fetch(getApiUrl() + '/api' + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Cannot reach the server. Check the server URL in settings.')
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
  apps: () => request('/apps', { auth: true }),
  screentime: (deviceUserId, startTime, endTime) =>
    request(
      `/screentime?deviceUserId=${deviceUserId}&startTime=${startTime}&endTime=${endTime}`,
      { auth: true }
    ),
  websiteHistory: (deviceUserId, startTime, endTime) =>
    request(
      `/website-history?deviceUserId=${deviceUserId}&startTime=${startTime}&endTime=${endTime}`,
      { auth: true }
    ),
  limits: (deviceUserId) => request(`/limits?deviceUserId=${deviceUserId}`, { auth: true }),
  setLimit: (deviceUserId, appId, dailyLimitMinutes) =>
    request('/limits', {
      method: 'PUT',
      auth: true,
      body: { deviceUserId, appId, dailyLimitMinutes },
    }),
  websiteLimits: (deviceUserId) =>
    request(`/website-limits?deviceUserId=${deviceUserId}`, { auth: true }),
  setWebsiteLimit: (deviceUserId, domain, dailyLimitMinutes) =>
    request('/website-limits', {
      method: 'PUT',
      auth: true,
      body: { deviceUserId, domain, dailyLimitMinutes },
    }),
  downtimes: (deviceUserId) => request(`/downtime?deviceUserId=${deviceUserId}`, { auth: true }),
  addDowntime: (deviceUserId, startMinute, endMinute, enabled) =>
    request('/downtime', {
      method: 'POST',
      auth: true,
      body: { deviceUserId, startMinute, endMinute, enabled },
    }),
  updateDowntime: (id, startMinute, endMinute, enabled) =>
    request(`/downtime/${id}`, {
      method: 'PUT',
      auth: true,
      body: { startMinute, endMinute, enabled },
    }),
  deleteDowntime: (id) => request(`/downtime/${id}`, { method: 'DELETE', auth: true }),
  manualBlock: (deviceUserId) => request(`/manual-block?deviceUserId=${deviceUserId}`, { auth: true }),
  setManualBlock: (deviceUserId, minutes) =>
    request('/manual-block', {
      method: 'POST',
      auth: true,
      body: { deviceUserId, minutes },
    }),
  clearManualBlock: (deviceUserId) =>
    request(`/manual-block?deviceUserId=${deviceUserId}`, { method: 'DELETE', auth: true }),
  disallowedBrowsers: (deviceUserId) =>
    request(`/disallowed-browsers?deviceUserId=${deviceUserId}`, { auth: true }),
  setDisallowedBrowsers: (deviceUserId, browsers) =>
    request('/disallowed-browsers', {
      method: 'PUT',
      auth: true,
      body: { deviceUserId, browsers },
    }),
  blockExceptions: (deviceUserId) =>
    request(`/block-exceptions?deviceUserId=${deviceUserId}`, { auth: true }),
  addBlockException: (deviceUserId, appId) =>
    request('/block-exceptions', {
      method: 'POST',
      auth: true,
      body: { deviceUserId, appId },
    }),
  removeBlockException: (id) => request(`/block-exceptions/${id}`, { method: 'DELETE', auth: true }),
}
