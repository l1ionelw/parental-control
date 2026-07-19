// Entry point for the Parental Controls browser monitor.
//
// Behavior:
// 1. Report every tab_switch/tab_url_changed event to the tray app's local
//    server as a "tab switch" - the tray app (TabActivityStore) is the durable
//    source of truth for tab state and relays it up to the remote server itself,
//    same as it already does for app-switch events. This extension no longer
//    talks to the remote server directly.
// 2. Heartbeat the currently active tab on a chrome.alarms timer (setInterval
//    doesn't survive a service worker restart, alarms do) so a tab that's never
//    switched away from - e.g. hours parked on a video - still accumulates real
//    screen time, and so the tray app can detect the browser closing (see
//    TabActivityStore's heartbeat-timeout watchdog).

import { startTabListener } from './tabListener.js'

const TRAY_APP_BASE_URL = 'http://127.0.0.1:58231';
const MAX_QUEUED_EVENTS = 500;
const HEARTBEAT_ALARM = 'website-heartbeat';
const HEARTBEAT_PERIOD_MINUTES = 1; // chrome.alarms' practical minimum granularity

// Persisted (not in-memory) so events survive the service worker being killed
// mid-request - MV3 tears the worker down after ~30s idle, which would
// otherwise silently drop anything queued while the tray app was unreachable.
const PENDING_KEY = 'pendingWebsiteEvents';

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
// before the worker died. postToTrayApp() already queues to disk if the tray
// app isn't reachable, so it's safe to start reporting immediately.
startTabListener(async (event) => {
  console.log('[parental-control] tab event:', event);
  await reportTabEvent(event);
});

async function getPendingEvents() {
  const { [PENDING_KEY]: events = [] } = await chrome.storage.local.get(PENDING_KEY);
  return events;
}

async function queuePendingEvent(path, body) {
  const events = await getPendingEvents();
  events.push({ path, body });
  if (events.length > MAX_QUEUED_EVENTS) events.shift();
  await chrome.storage.local.set({ [PENDING_KEY]: events });
}

// Drains whatever queued up on disk while the tray app was unreachable
// (including across a service worker restart) - checked before every send, not
// just on some reconnect event, since there's no persistent connection anymore.
async function flushPending() {
  const events = await getPendingEvents();
  if (!events.length) return;

  await chrome.storage.local.set({ [PENDING_KEY]: [] });
  console.log(`[parental-control] flushing ${events.length} queued event(s)`);

  for (const { path, body } of events) {
    await postToTrayApp(path, body, /* allowQueue */ true);
  }
}

async function postToTrayApp(path, body, allowQueue = true) {
  try {
    const res = await fetch(`${TRAY_APP_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`tray app returned ${res.status}`);
  } catch (err) {
    console.error(`[parental-control] failed to reach tray app at ${path}, queueing:`, err);
    if (allowQueue) await queuePendingEvent(path, body);
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

// tab_switch and tab_url_changed both mean "a new tab just became active" -
// report both the same way; the tray app closes whatever it had open and opens
// a session for the new tab.
async function reportTabEvent(event) {
  await flushPending();

  const after = event.after && event.after.url
    ? { url: event.after.url, title: event.after.title || '' }
    : null;
  if (!after) return;

  await postToTrayApp('/tab-switch', { url: after.url, title: after.title, timestamp: event.endTimeMs });
}

async function sendHeartbeat() {
  await flushPending();

  const tab = await getActiveTabInfo();
  if (!tab) return;
  await postToTrayApp('/tab-heartbeat', { url: tab.url, title: tab.title, timestamp: Date.now() });
}

async function main() {
  // Idempotent - re-creating an existing alarm resets its schedule, so only
  // create it if it isn't already running (this function reruns on every
  // service worker wake, including ones the alarm itself triggers).
  const existingAlarm = await chrome.alarms.get(HEARTBEAT_ALARM);
  if (!existingAlarm) {
    chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_PERIOD_MINUTES });
  }

  await flushPending();
}

main();
