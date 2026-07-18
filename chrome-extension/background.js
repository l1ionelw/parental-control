// Debug-only service worker. Records tab-switch events to chrome.storage.local
// (not an in-memory array - MV3 service workers get killed when idle, so
// anything not persisted would vanish between events) and the debug page
// reads/live-updates from there.

const STORAGE_KEY = 'events';
const MAX_EVENTS = 500;

// In-memory only for context between events within one SW lifetime - if the SW
// gets killed and restarts, this resets to null, which just means the very next
// event after a restart won't have a "before" snapshot. Fine for a debug tool.
let lastActiveTab = null; // { tabId, windowId, tab }

// Seed from current state on startup (extension install/enable, or the SW
// waking back up) so the first real event has a proper "before" instead of null.
(async () => {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (activeTab) lastActiveTab = { tabId: activeTab.id, windowId: activeTab.windowId, tab: activeTab };
  } catch {
    // no windows open yet - default is fine
  }
})();

async function addEvent(event) {
  const { [STORAGE_KEY]: events = [] } = await chrome.storage.local.get(STORAGE_KEY);
  events.unshift({ id: crypto.randomUUID(), timestamp: Date.now(), ...event });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  await chrome.storage.local.set({ [STORAGE_KEY]: events });
}

// Pulls out the fields worth looking at for debugging - chrome.tabs.Tab has more
// (openerTabId, discarded, etc.) but this covers what was asked for plus the
// obviously useful extras.
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
    // Tab can vanish between the event firing and us querying it (closed fast).
    return null;
  }
}

// --- Tab switch (chrome.tabs.onActivated) ---------------------------------
// Fires when the active tab within a window changes - this is the "switch tab"
// case (new tab, existing tab click, ctrl+tab, etc), including switching to a
// different (already-focused-before) window whose active tab differs from this
// one's. It does NOT fire for a background tab's title/url changing - that's
// onUpdated, handled below only to keep our "last known" snapshot fresh, not
// logged as its own event type.

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  const newTab = await getTabSafe(tabId);
  const before = lastActiveTab?.tab ?? null;

  await addEvent({
    type: 'tab_switch',
    windowId,
    before: serializeTab(before),
    after: serializeTab(newTab),
  });

  lastActiveTab = { tabId, windowId, tab: newTab };
});

// --- Active tab URL change (chrome.tabs.onUpdated) ------------------------
// Fires for lots of things (title changes, favicon loads, etc) - changeInfo.url
// is only present on the update that actually changed the URL (navigation,
// redirect, SPA history push, etc). Scoped to tab.active so this stays about
// "what the active tab navigated to," not every background tab's traffic.

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    const before = lastActiveTab?.tabId === tabId ? lastActiveTab.tab : null;

    await addEvent({
      type: 'tab_url_changed',
      tabId,
      windowId: tab.windowId,
      before: serializeTab(before),
      after: serializeTab(tab),
    });
  }

  if (lastActiveTab && lastActiveTab.tabId === tabId) {
    lastActiveTab.tab = tab;
  }
});

// --- Open (or focus) the debug page on toolbar click -----------------------
// No default_popup in the manifest on purpose: a popup closes the instant it
// loses focus, which is exactly what happens the moment you switch tabs to
// generate an event - useless for watching a live log. A regular page in its
// own tab stays open through all of that.

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('debug.html');
  const existing = await chrome.tabs.query({ url });

  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});
