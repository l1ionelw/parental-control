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
// 3. Check the active tab's domain against its limit on every event that also
//    gets reported to the tray app - tab_switch, tab_url_changed, the
//    1-minute heartbeat, and webNavigation's onBeforeNavigate/
//    onHistoryStateUpdated for the active tab's main frame - so switching
//    straight into an already-over-limit site, typing a new URL into an
//    already-blocked tab, or a same-tab SPA route change all get caught as
//    early as possible, and a tab that's never switched away from still gets
//    re-checked as its usage climbs. The separate 3-minute alarm is kept as a
//    fallback in case none of those fire for a while. Usage itself is
//    only refreshed tray-app-side every few minutes (see
//    TabActivityStore.RecomputeDomainUsage), so checking more often than that
//    doesn't get fresher numbers, but it does close the window between the
//    limit being crossed and getting caught. If a tab is over, redirect it to
//    the bundled blocked page - purely client-side, no round-trip back to the
//    tray app needed for the enforcement action itself.

import { startTabListener } from './tabListener.js'

const TRAY_APP_BASE_URL = 'http://127.0.0.1:58231';
const MAX_QUEUED_EVENTS = 500;
const HEARTBEAT_ALARM = 'website-heartbeat';
const HEARTBEAT_PERIOD_MINUTES = 1; // chrome.alarms' practical minimum granularity
const LIMIT_CHECK_ALARM = 'website-limit-check';
const LIMIT_CHECK_PERIOD_MINUTES = 3;

// Persisted (not in-memory) so events survive the service worker being killed
// mid-request - MV3 tears the worker down after ~30s idle, which would
// otherwise silently drop anything queued while the tray app was unreachable.
const PENDING_KEY = 'pendingWebsiteEvents';

// Registered at top level so it survives service worker restarts and can wake a
// dead worker on its own - see chrome.alarms.create() call in main().
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    sendHeartbeat();
  } else if (alarm.name === LIMIT_CHECK_ALARM) {
    checkActiveTabLimit();
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
  await checkActiveTabLimit();
});

// Catches navigations that tabs.onUpdated can miss or only report late:
// typing/following a link to a new URL in the active tab, and same-tab SPA
// route changes (history.pushState/replaceState) that never fire onUpdated
// with a changeInfo.url at all. frameId 0 = the top-level document, not
// iframes. Only checked when it's the currently-active tab that navigated -
// background tab navigations don't affect what's on screen right now.
//
// details.url is the destination, and is passed straight through rather than
// re-read from chrome.tabs: at onBeforeNavigate time the tab still reports
// its pre-navigation URL, so re-querying it here would check the page being
// left instead of the one about to load.
async function onMainFrameNavigation(details) {
  if (details.frameId !== 0) return;
  try {
    const tab = await chrome.tabs.get(details.tabId);
    if (!tab.active) return;
  } catch {
    return;
  }
  await checkActiveTabLimit(details.tabId, details.url);
}

chrome.webNavigation.onBeforeNavigate.addListener(onMainFrameNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(onMainFrameNavigation);

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
  await checkActiveTabLimit();
}

// Best-effort hostname for matching against a domain limit - same fallback
// behavior as react-client/src/screens/ScreenTime.jsx's domainOf, and needs to
// agree with it since limits are keyed by whatever domain TabActivityStore's
// RecomputeDomainUsage computed trayapp-side (see LocalExtensionServer's
// /website-status).
function domainOf(url) {
  try {
    return new URL(url).hostname || url || '';
  } catch {
    return url || '';
  }
}

// Checks a tab's domain against its limit, using the tray app's
// already-computed browser-focus-clamped usage - called on every tab
// switch/URL change, on the 1-minute heartbeat, on the 3-minute fallback
// alarm, and on webNavigation events (see module docstring).
//
// tabId/urlOverride let onBeforeNavigate check the navigation's *destination*
// instead of the tab's current URL: chrome.tabs still reports the old URL
// until the navigation commits, so querying the active tab there would just
// re-check the page being left, not the one about to load.
async function checkActiveTabLimit(tabId, urlOverride) {
  let status;
  try {
    const res = await fetch(`${TRAY_APP_BASE_URL}/website-status`);
    if (!res.ok) throw new Error(`tray app returned ${res.status}`);
    status = await res.json();
  } catch (err) {
    console.error('[parental-control] failed to fetch website-status:', err);
    return;
  }

  let targetTabId = tabId;
  let url = urlOverride;
  if (url == null) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.url || tab.id == null) return;
    targetTabId = tab.id;
    url = tab.url;
  }
  if (targetTabId == null || !url) return;

  const domain = domainOf(url);
  if (!domain) return;

  const limitMinutes = status.limits?.[domain];
  if (limitMinutes == null) return; // no limit configured for this domain

  const usedSeconds = status.usage?.[domain] || 0;
  if (usedSeconds < limitMinutes * 60) return;

  console.log(`[parental-control] ${domain} is over its daily limit (${usedSeconds}s >= ${limitMinutes}m), blocking tab`);
  const blockedUrl = chrome.runtime.getURL(`blocked.html?domain=${encodeURIComponent(domain)}`);
  try {
    await chrome.tabs.update(targetTabId, { url: blockedUrl });
  } catch (err) {
    console.error('[parental-control] failed to redirect over-limit tab:', err);
  }
}

async function main() {
  // Idempotent - re-creating an existing alarm resets its schedule, so only
  // create it if it isn't already running (this function reruns on every
  // service worker wake, including ones the alarm itself triggers).
  const existingHeartbeat = await chrome.alarms.get(HEARTBEAT_ALARM);
  if (!existingHeartbeat) {
    chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_PERIOD_MINUTES });
  }

  const existingLimitCheck = await chrome.alarms.get(LIMIT_CHECK_ALARM);
  if (!existingLimitCheck) {
    chrome.alarms.create(LIMIT_CHECK_ALARM, { periodInMinutes: LIMIT_CHECK_PERIOD_MINUTES });
  }

  await flushPending();
}

main();
