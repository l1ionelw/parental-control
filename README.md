# Parental Controls

- `server/` - Flask API + websocket backend (SQLite)
- `react-client/` - admin/parent dashboard (Vite + React)
- `trayapp/` - Windows tray app that tracks foreground application usage and enforces limits/downtime
- `chrome-extension/` - browser extension that tracks tab/website usage, reporting through a native host that reads the trayapp's config
- `debug-chrome-extension/` - scratch extension used for debugging the native messaging host

## Known limitations

### App-usage tracking only records a session when you switch away from it

The trayapp reports a finished application session (`window_changed`) only when
the OS foreground window changes - there's no periodic heartbeat for app usage.
This means an app that's used for a long, uninterrupted stretch (foreground the
whole time, no window switch) doesn't get recorded until you switch away from
it. If you never switch away before checking screen time, that stretch is
invisible until you do.

(The browser extension's own tab tracking does *not* have this problem anymore -
it heartbeats the currently active tab every ~1 minute via `chrome.alarms`, so a
tab left open for hours still accumulates real time. See `chrome-extension/background.js`
and `server/browser_ws.py`. The app-usage side was never upgraded to the same
heartbeat model.)

### This compounds for the "filter by browser foreground" screen time view

`react-client`'s browser screen time view (`/screentime/browser`) can filter tab
activity down to only the time the browser process itself was actually in the
OS foreground (see `clipEventsToActive` in `ScreenTime.jsx`) - this corrects for
the browser extension not being able to reliably detect Chrome losing focus
(alt-tab, taskbar app switch) on its own.

That filter works by intersecting website events with the browser exe's
app-usage `events` (from `/api/screentime`). Because of the limitation above,
the browser's own foreground interval isn't recorded by the trayapp until the
OS foreground app changes *away from the browser* - switching tabs within the
browser doesn't trigger that. So even though the raw tab data is already
correct and complete (thanks to the heartbeat), the filtered view won't reflect
a long, uninterrupted browsing session until you actually switch to a different
application. Both have to happen for the filter to pick it up:

1. The tab changes (already handled well - heartbeat + switch events).
2. The OS foreground app changes away from the browser (finalizes the trayapp's
   `chrome`/`brave`/etc. event, which is what the filter intersects against).

Until #2 happens, that stretch of foreground browser time is invisible to the
filter and gets excluded from the filtered totals, even though it's sitting in
`websiteEvents` correctly. The fix would be giving the trayapp's app-usage
tracking the same heartbeat treatment the browser extension already has.

### Website domain blocking re-fetches and recomputes everything on every tab switch, and inherits the same lag

The extension enforces per-domain daily limits (`chrome-extension/background.js`
`checkAndEnforceBlock`) by asking the server for two fresh payloads on every
`tab_switch`/`tab_url_changed` event: `get_website_limits` and
`get_website_usage`. `get_website_usage` isn't a cached lookup - the server
recomputes it from scratch every time (`browser_ws._build_website_usage_payload`):
re-query every app-usage event for browser exes today, re-merge those into
foreground intervals, re-query every website event today, and re-clip/re-sum by
domain. On a busy day this is a non-trivial amount of work happening on *every
single tab switch*, not just when usage is actually checked - it's simple to
reason about but scales badly and should eventually be replaced with
incremental/cached usage tracking instead of a full recompute per switch.

It also directly inherits the limitations above: `get_website_usage`'s
foreground-clamping depends on the trayapp's app-usage events for the browser
exe, which (per the first limitation) only get recorded when the OS foreground
app changes *away* from the browser - not on a tab switch within it. So a
domain limit is only actually re-checked against fresh, accurate usage once
both a tab change *and* an app-level switch away from the browser have
happened recently enough to have updated the clamp data. If someone parks on a
single over-the-limit-eventually domain for a long stretch without ever
switching tabs or alt-tabbing away, the block won't trigger until one of those
finally happens - potentially a large disparity between "actually over the
limit" and "extension notices and blocks it." This needs a proper fix later
(e.g. periodic re-checks via the heartbeat, once the trayapp side also has one -
see above - rather than only on a switch).
