// Entry point for the Parental Controls browser monitor.
//
// Behavior:
// 1. Connect to the native host to get deviceId/deviceName/osUsername/serverUrl.
// 2. Register the device (mirrors trayapp's ServerCommunicator.EnsureDeviceRegistered)
//    to get a userId, then open the same /ws WebSocket the trayapp uses.
// 3. On every (re)connect - including after this service worker was killed and
//    restarted from scratch, which wipes all local memory - ask the server what
//    tab it currently thinks is open (get_open_website_session) and reconcile
//    against the real active tab, since the server is the durable source of
//    truth, not this script.
// 4. Report every tab_switch/tab_url_changed event as "website_changed" (closes
//    the server's currently-open session, opens a new one for the tab just
//    activated).
// 5. Heartbeat the currently active tab on a chrome.alarms timer (setInterval
//    doesn't survive a service worker restart, alarms do) so a tab that's never
//    switched away from - e.g. hours parked on a video - still accumulates real
//    screen time instead of being invisible until the next switch.

import { startTabListener } from './tabListener.js'

const NATIVE_HOST = 'com.parentalcontrol.native_host';
const RECONNECT_DELAY_MS = 5000;
const MAX_QUEUED_EVENTS = 500;
const HEARTBEAT_ALARM = 'website-heartbeat';
const HEARTBEAT_PERIOD_MINUTES = 1; // chrome.alarms' practical minimum granularity

// Persisted (not in-memory) so events survive the service worker being killed
// mid-disconnect - MV3 tears the worker down after ~30s idle, which would
// otherwise silently drop anything queued while the socket was down.
const PENDING_KEY = 'pendingWebsiteEvents';

let ws = null;
let wsConnected = false;
let deviceId = null;
let userId = null;
let username = null;
let serverUrl = null;

// Registered at top level so it survives service worker restarts and can wake a
// dead worker on its own - see chrome.alarms.create() call in main().
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    sendHeartbeat();
  }
});

// Registered synchronously at top level, before any await, for the same reason:
// MV3 only wakes a terminated service worker to deliver an event (e.g. the very
// tab switch we want to catch) if a listener for it was already registered
// before the worker died. Anything gated behind async setup (native host,
// device registration, websocket connect) below would race that wake-up and
// could miss the event entirely. sendWebsiteChanged() already queues to disk if
// the websocket isn't connected yet, so it's safe to start reporting immediately.
startTabListener(async (event) => {
  console.log('[parental-control] tab event:', event);
  await reportTabEvent(event);
});

function connectNativeHost() {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { port.disconnect(); } catch {}
        reject(new Error('native host timed out'));
      }
    }, 5000);

    port.onMessage.addListener((msg) => {
      if (resolved) return;
      clearTimeout(timeout);
      resolved = true;
      if (msg.error) {
        reject(new Error(msg.error));
      } else {
        resolve(msg);
      }
    });

    port.onDisconnect.addListener(() => {
      if (!resolved) {
        clearTimeout(timeout);
        resolved = true;
        const err = chrome.runtime.lastError;
        reject(new Error(err?.message || 'native host disconnected'));
      }
    });
  });
}

// Same endpoint/shape the trayapp uses (ServerCommunicator.EnsureDeviceRegistered) -
// idempotent by deviceId, so calling it again on every extension startup is fine.
async function registerDevice(deviceName, osUsername) {
  const res = await fetch(`${serverUrl}/api/devices/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, deviceName, osUsername }),
  });
  if (!res.ok) throw new Error(`device registration failed: ${res.status}`);
  return res.json();
}

function wsUrlFromServerUrl(url) {
  const u = new URL(url);
  const wsProtocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${u.host}/ws`;
}

async function getPendingEvents() {
  const { [PENDING_KEY]: events = [] } = await chrome.storage.local.get(PENDING_KEY);
  return events;
}

async function queuePendingEvent(message) {
  const events = await getPendingEvents();
  events.push(message);
  if (events.length > MAX_QUEUED_EVENTS) events.shift();
  await chrome.storage.local.set({ [PENDING_KEY]: events });
}

// Drains whatever queued up on disk while the socket was down (including across
// a service worker restart) - checked on every reconnect, not just the first.
async function flushPending() {
  const events = await getPendingEvents();
  if (!events.length) return;

  await chrome.storage.local.set({ [PENDING_KEY]: [] });
  console.log(`[parental-control] flushing ${events.length} queued event(s)`);

  for (const event of events) {
    if (wsConnected) {
      ws.send(JSON.stringify(event));
    } else {
      await queuePendingEvent(event);
    }
  }
}

// The tab chrome.tabs itself says is active right now - queried fresh every time
// rather than trusted from memory, since memory doesn't survive a service worker
// restart (see module docstring).
async function getActiveTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.url) return null;
    return { url: tab.url, title: tab.title || '' };
  } catch {
    return null;
  }
}

// Asks the server what it currently has open for this device-user and corrects
// it if it doesn't match the real active tab - covers the case where a switch
// happened while this service worker was dead and thus never got reported.
async function reconcileOpenSession(session) {
  const currentTab = await getActiveTabInfo();
  const currentUrl = currentTab ? currentTab.url : null;
  const cachedUrl = session ? session.tabUrl : null;

  if (currentUrl === cachedUrl) return;

  console.log('[parental-control] reconciling open session:', { cachedUrl, currentUrl });
  await sendWebsiteChanged({
    type: 'website_changed',
    after: currentTab,
    switchTime: Date.now(),
  });
}

function connectWebSocket() {
  ws = new WebSocket(wsUrlFromServerUrl(serverUrl));

  ws.addEventListener('open', () => {
    wsConnected = true;
    ws.send(JSON.stringify({ type: 'handshake', deviceId, userId, username }));
    flushPending();
    ws.send(JSON.stringify({ type: 'get_open_website_session' }));
    console.log('[parental-control] websocket connected');
  });

  ws.addEventListener('message', (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (data.type === 'open_website_session') {
      reconcileOpenSession(data.session);
    }
  });

  ws.addEventListener('close', () => {
    wsConnected = false;
    setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
  });

  ws.addEventListener('error', (err) => {
    console.error('[parental-control] websocket error:', err);
    try { ws.close(); } catch {}
  });
}

async function sendWebsiteChanged(message) {
  if (wsConnected) {
    try {
      ws.send(JSON.stringify(message));
      return;
    } catch (err) {
      console.error('[parental-control] send failed, queueing:', err);
    }
  }
  await queuePendingEvent(message);
}

// tab_switch and tab_url_changed both mean "a new tab just became active" -
// report both the same way; the server closes whatever it had open and opens a
// session for `after` (it already knows what was open, so `before` isn't needed).
async function reportTabEvent(event) {
  const after = event.after && event.after.url
    ? { url: event.after.url, title: event.after.title || '' }
    : null;

  await sendWebsiteChanged({
    type: 'website_changed',
    after,
    switchTime: event.endTimeMs,
  });
}

async function sendHeartbeat() {
  const tab = await getActiveTabInfo();
  if (!tab) return;
  await sendWebsiteChanged({ type: 'website_heartbeat', tab, timestamp: Date.now() });
}

async function main() {
  try {
    // Idempotent - re-creating an existing alarm resets its schedule, so only
    // create it if it isn't already running (this function reruns on every
    // service worker wake, including ones the alarm itself triggers).
    const existingAlarm = await chrome.alarms.get(HEARTBEAT_ALARM);
    if (!existingAlarm) {
      chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_PERIOD_MINUTES });
    }

    const details = await connectNativeHost();
    console.log('[parental-control] native host details:', details);

    deviceId = details.deviceId;
    serverUrl = details.serverUrl;
    if (!serverUrl) throw new Error('no serverUrl from native host (trayapp not configured yet?)');

    const registration = await registerDevice(details.deviceName, details.osUsername);
    userId = registration.userId;
    username = registration.username;
    console.log('[parental-control] registered as userId:', userId);

    connectWebSocket();
  } catch (err) {
    console.error('[parental-control] startup error:', err);
  }
}

main();
