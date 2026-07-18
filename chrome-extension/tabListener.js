// Reusable browser tab-activity listener.
//
// Tracks the active tab across windows, tab switches, and active-tab URL changes.
// Calls back with a uniform event object whenever the user lands on a different
// effective tab context:
//
//   {
//     type: 'tab_switch' | 'tab_url_changed',
//     before: { tabId, windowId, index, title, url, ... } | null,
//     after:  { tabId, windowId, index, title, url, ... } | null,
//     startTimeMs: number,
//     endTimeMs: number,
//   }
//
// Usage:
//   startTabListener((event) => { ... })
//   stopTabListener()

const MAX_EVENTS = 500;
const STORAGE_KEY = 'events';

let lastActiveTab = null; // { tabId, windowId, tab, startTimeMs }
let running = false;
let callback = null;

async function seedCurrentTab() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab) {
      lastActiveTab = {
        tabId: activeTab.id,
        windowId: activeTab.windowId,
        tab: activeTab,
        startTimeMs: Date.now(),
      };
    }
  } catch {
    // no windows open yet
  }
}

function serializeTab(tab) {
  if (!tab) return null;
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    pinned: tab.pinned,
    audible: tab.audible,
    mutedInfo: tab.mutedInfo,
    status: tab.status,
    favIconUrl: tab.favIconUrl,
    groupId: tab.groupId,
  };
}

async function getTabSafe(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function persistEvent(event) {
  const { [STORAGE_KEY]: events = [] } = await chrome.storage.local.get(STORAGE_KEY);
  events.unshift({ id: crypto.randomUUID(), timestamp: Date.now(), ...event });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  await chrome.storage.local.set({ [STORAGE_KEY]: events });
}

async function emit(type, before, after) {
  const now = Date.now();
  const startTime = lastActiveTab?.startTimeMs ?? now;

  const event = {
    type,
    before: serializeTab(before),
    after: serializeTab(after),
    startTimeMs: startTime,
    endTimeMs: now,
  };

  await persistEvent(event);
  callback?.(event);

  lastActiveTab = {
    tabId: after?.id,
    windowId: after?.windowId,
    tab: after,
    startTimeMs: now,
  };
}

async function onActivated({ tabId, windowId }) {
  const newTab = await getTabSafe(tabId);
  const before = lastActiveTab?.tab ?? null;
  await emit('tab_switch', before, newTab);
}

async function onUpdated(tabId, changeInfo, tab) {
  if (!changeInfo.url || !tab.active) return;
  const before = lastActiveTab?.tabId === tabId ? lastActiveTab.tab : null;
  await emit('tab_url_changed', before, tab);
}

// Synchronous and listener-registration-first by design: MV3 wakes a terminated
// service worker to deliver an event only if a listener was already registered
// before the worker died. If this were async with an await before addListener
// (as it used to be, via `await seedCurrentTab()`), a service worker woken
// specifically to deliver the very tabs.onActivated/onUpdated event this
// registers for could lose the race and never see it. seedCurrentTab() runs
// fire-and-forget afterward - it only affects `before`/startTimeMs bookkeeping,
// which callers no longer need synchronously.
export function startTabListener(onEvent) {
  if (running) {
    console.warn('[tabListener] already running');
    return;
  }

  callback = onEvent;
  running = true;

  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onUpdated.addListener(onUpdated);

  seedCurrentTab();

  console.log('[tabListener] started');
}

export function stopTabListener() {
  if (!running) return;

  chrome.tabs.onActivated.removeListener(onActivated);
  chrome.tabs.onUpdated.removeListener(onUpdated);

  callback = null;
  running = false;
  lastActiveTab = null;

  console.log('[tabListener] stopped');
}

export function getLastActiveTab() {
  return lastActiveTab ? serializeTab(lastActiveTab.tab) : null;
}
