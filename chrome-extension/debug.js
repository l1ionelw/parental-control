const STORAGE_KEY = 'events';

const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const clearBtn = document.getElementById('clear');

const TYPE_LABELS = {
  tab_switch: 'Tab switch',
  tab_url_changed: 'Active tab URL changed',
};

function render(events) {
  countEl.textContent = `${events.length} event${events.length === 1 ? '' : 's'}`;

  if (events.length === 0) {
    listEl.innerHTML = '<div class="empty">No events yet - switch tabs to generate some.</div>';
    return;
  }

  listEl.innerHTML = events
    .map((event) => {
      const { id, type, timestamp, ...details } = event;
      const time = new Date(timestamp).toLocaleTimeString(undefined, {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      return `
        <div class="event">
          <div class="event-head">
            <span class="badge ${type}">${TYPE_LABELS[type] || type}</span>
            <span class="timestamp">${time}</span>
          </div>
          <pre>${escapeHtml(JSON.stringify(details, null, 2))}</pre>
        </div>
      `;
    })
    .join('');
}

function escapeHtml(str) {
  return str.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function loadAndRender() {
  const { [STORAGE_KEY]: events = [] } = await chrome.storage.local.get(STORAGE_KEY);
  render(events);
}

// Live-updates while this page stays open, since the service worker writes
// straight to storage as events happen.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) {
    render(changes[STORAGE_KEY].newValue || []);
  }
});

clearBtn.addEventListener('click', async () => {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
});

loadAndRender();
