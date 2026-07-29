using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using trayapp.Structs;
using TrayApp;

namespace trayapp
{
    // Single source of truth for tab/website activity, fed by LocalExtensionServer
    // on behalf of the chrome extension (which used to hold and report all of this
    // itself, straight to the remote server - see chrome-extension/background.js).
    // Holds the events table, the currently-active tab, a running per-URL usage
    // tally, and the domain daily limits synced from the server - mirrors
    // AppActivityStore's shape on the tab side. Relays every switch/heartbeat up
    // to the remote server via ServerCommunicator so nothing changes for that
    // side of the wire.
    //
    // Enforcement itself (closing an over-limit tab) is NOT done here or anywhere
    // in the trayapp - the chrome extension does that on its own 3-minute timer,
    // asking LocalExtensionServer for limits + the browser-focus-clamped usage
    // this class computes (see RecomputeDomainUsage). That clamping is the
    // "real tab usage" calculation - it can't just be a running per-switch tally
    // like AppUsages, since a tab can stay "open" per the extension long after the
    // browser itself loses OS focus (the extension has no visibility into that -
    // only WindowChangedListener/AppActivityStore does), so it's recomputed fresh
    // every few minutes from the raw event streams instead of accumulated
    // incrementally.
    internal static class TabActivityStore
    {
        // If the extension hasn't heartbeated (or switched tabs) in this long, the
        // browser has likely closed without a final event (service worker killed,
        // Chrome exited, etc.) - the watchdog loop below closes out the current
        // tab on this basis.
        private static readonly long HeartbeatTimeoutMs = 3 * 60 * 1000;
        private static readonly int WatchdogTickSeconds = 30;

        // How often the (deliberately not cheap - see class doc) browser-focus
        // clamp recompute runs, and how often website limits get resynced from
        // the server. Both independent of WatchdogTickSeconds above.
        private static readonly int DomainUsageRecomputeSeconds = 3 * 60;
        private static readonly int LimitsReloadSeconds = 20;

        // Known browser executables - only these count as "the browser has focus"
        // for the clamp below. Hardcoded rather than synced/configurable since a
        // handful of desktop browsers cover the overwhelming majority of users;
        // mirrors BROWSER_EXE_NAMES in react-client/src/screens/ScreenTime.jsx.
        private static readonly HashSet<string> BrowserExeNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "chrome", "msedge", "firefox", "brave", "opera", "vivaldi"
        };

        internal struct TabEvent
        {
            public string Url;
            public string Title;
            public long StartTime;
            public long EndTime;
        }

        private static readonly List<TabEvent> _events = new List<TabEvent>();
        private static readonly Dictionary<string, int> _tabUsageSeconds =
            new Dictionary<string, int>();
        private static Dictionary<string, int> _domainUsageSeconds =
            new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        private static List<WebsiteLimit> _websiteLimits = new List<WebsiteLimit>();
        private static bool _hasSeededHistory;
        private static readonly object _lock = new object();

        private static string _currentUrl;
        private static string _currentTitle;
        private static long _currentSwitchTime;
        private static bool _hasCurrentTab;
        private static long _lastHeartbeatMs;

        private static CancellationTokenSource _cts;

        public static void Start()
        {
            _cts = new CancellationTokenSource();
            ServerCommunicator.RegisterMessageHandler("website_limits", OnWebsiteLimitsMessage);
            ServerCommunicator.RegisterMessageHandler("today_website_events", OnTodayWebsiteEventsMessage);

            _ = Task.Run(() => WatchdogLoop(_cts.Token));
            _ = Task.Run(() => DomainUsageLoop(_cts.Token));
            _ = Task.Run(() => LimitsReloadLoop(_cts.Token));
        }

        // Called once per process lifetime, on the first successful server
        // connection (see ServerCommunicator.SendHandshake) - the tab-side twin of
        // AppActivityStore.SeedTodayHistory, same reasoning: backfills _events with
        // today's already-persisted WebsiteEvent rows so RecomputeDomainUsage isn't
        // blind to whatever happened before this trayapp process started.
        public static async Task SeedTodayHistory(CancellationToken token)
        {
            lock (_lock)
            {
                if (_hasSeededHistory)
                    return;
                _hasSeededHistory = true;
            }

            await ServerCommunicator.SendRequest(new { type = "get_today_website_events" }, token);
        }

        private static void OnTodayWebsiteEventsMessage(JsonElement root)
        {
            if (!root.TryGetProperty("events", out var arr))
                return;

            var seeded = new List<TabEvent>();
            foreach (var item in arr.EnumerateArray())
            {
                seeded.Add(new TabEvent
                {
                    Url = item.GetProperty("tabUrl").GetString(),
                    Title = item.TryGetProperty("tabTitle", out var t) ? t.GetString() : "",
                    StartTime = item.GetProperty("startTime").GetInt64(),
                    EndTime = item.GetProperty("endTime").GetInt64(),
                });
            }

            lock (_lock)
            {
                _events.InsertRange(0, seeded);
            }

            Logger.Log($"TabActivityStore: seeded {seeded.Count} historical tab event(s) for today from the server");
        }

        public static void Stop()
        {
            _cts?.Cancel();
        }

        // Called by ServerCommunicator when the server connection drops - clears
        // synced limits, since they may now be stale (tab tracking itself keeps
        // running regardless - see ServerCommunicator's queue-on-failure). Same
        // tradeoff ScreenTimeEnforcer.Deactivate already accepts for app limits.
        public static void Deactivate()
        {
            lock (_lock)
            {
                _websiteLimits = new List<WebsiteLimit>();
            }
        }

        // Called on every tab_switch/tab_url_changed the extension reports - closes
        // out whatever tab was previously current (if any) and opens 'url' as the
        // new current tab.
        public static void RecordTabSwitch(string url, string title, long timestamp)
        {
            Logger.Log("Tab switched");
            CloseCurrentTab(timestamp);

            lock (_lock)
            {
                _currentUrl = url;
                _currentTitle = title;
                _currentSwitchTime = timestamp;
                _hasCurrentTab = true;
                _lastHeartbeatMs = timestamp;
            }

            ServerCommunicator.ReportWebsiteSession(url, title, timestamp);
        }

        // Called on every tab_heartbeat the extension reports.
        public static void RecordHeartbeat(string url, string title, long timestamp)
        {
            bool matchesCurrent;
            lock (_lock)
            {
                matchesCurrent = _hasCurrentTab && string.Equals(_currentUrl, url, StringComparison.Ordinal);
                if (matchesCurrent)
                    _lastHeartbeatMs = timestamp;
            }

            // A heartbeat for a tab we don't think is current means we missed a
            // switch (e.g. the service worker restarted) - treat it like a switch
            // instead of silently dropping it.
            if (!matchesCurrent)
            {
                Logger.Log("[TabStore] Tab Mismatch from heartbeat, doing switch now");
                RecordTabSwitch(url, title, timestamp);
                return;
            }

            ServerCommunicator.ReportWebsiteHeartbeat(url, title, timestamp);
        }

        public static List<TabEvent> GetEvents()
        {
            lock (_lock)
            {
                return new List<TabEvent>(_events);
            }
        }

        public static bool TryGetCurrentTab(out string url, out string title, out long switchTime)
        {
            lock (_lock)
            {
                url = _currentUrl;
                title = _currentTitle;
                switchTime = _currentSwitchTime;
                return _hasCurrentTab;
            }
        }

        public static Dictionary<string, int> GetUsageSeconds()
        {
            lock (_lock)
            {
                return new Dictionary<string, int>(_tabUsageSeconds);
            }
        }

        // domain -> seconds, as of the last DomainUsageLoop tick - the
        // browser-focus-clamped "real" usage the extension checks against
        // website limits. Served to the extension via LocalExtensionServer.
        public static Dictionary<string, int> GetDomainUsageSeconds()
        {
            lock (_lock)
            {
                return new Dictionary<string, int>(_domainUsageSeconds, StringComparer.OrdinalIgnoreCase);
            }
        }

        public static List<WebsiteLimit> GetWebsiteLimits()
        {
            lock (_lock)
            {
                return new List<WebsiteLimit>(_websiteLimits);
            }
        }

        // Appends the current tab (if any) as a finished event ending at 'endTime'
        // and tallies its duration. Leaves 'hasCurrentTab' state to the caller.
        private static void CloseCurrentTab(long endTime)
        {
            lock (_lock)
            {
                if (!_hasCurrentTab)
                    return;

                _events.Add(new TabEvent
                {
                    Url = _currentUrl,
                    Title = _currentTitle,
                    StartTime = _currentSwitchTime,
                    EndTime = endTime
                });

                int usedSeconds = (int)((endTime - _currentSwitchTime) / 1000);
                if (usedSeconds > 0 && !string.IsNullOrEmpty(_currentUrl))
                {
                    _tabUsageSeconds.TryGetValue(_currentUrl, out int existing);
                    _tabUsageSeconds[_currentUrl] = existing + usedSeconds;
                }
            }
        }

        private static async Task WatchdogLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try { await Task.Delay(TimeSpan.FromSeconds(WatchdogTickSeconds), token); }
                catch (TaskCanceledException) { break; }

                CheckHeartbeatTimeout();
            }
        }

        private static void CheckHeartbeatTimeout()
        {
            long lastHeartbeatMs;
            bool hasCurrentTab;
            lock (_lock)
            {
                hasCurrentTab = _hasCurrentTab;
                lastHeartbeatMs = _lastHeartbeatMs;
            }

            if (!hasCurrentTab)
                return;

            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (now - lastHeartbeatMs < HeartbeatTimeoutMs)
                return;

            Logger.Log("TabActivityStore: no heartbeat in 3 minutes, closing current tab (browser likely closed)");

            // Close out using the last confirmed-alive timestamp, not 'now' - we
            // don't know what actually happened in the gap since, so don't inflate
            // usage by the detection lag.
            CloseCurrentTab(lastHeartbeatMs);

            lock (_lock)
            {
                _currentUrl = null;
                _currentTitle = null;
                _hasCurrentTab = false;
            }

            ServerCommunicator.ReportWebsiteSession(null, null, lastHeartbeatMs);
        }

        private static async Task LimitsReloadLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                await ManualReload(token);

                try { await Task.Delay(TimeSpan.FromSeconds(LimitsReloadSeconds), token); }
                catch (TaskCanceledException) { break; }
            }
        }

        // Exposed so ServerCommunicator can trigger an immediate fetch on connect/
        // reconnect instead of waiting up to LimitsReloadSeconds for the periodic
        // loop to get around to it - same pattern as ScreenTimeEnforcer/DowntimeEnforcer.
        public static async Task ManualReload(CancellationToken token)
        {
            if (!ServerCommunicator.IsConnected)
                return;

            await ServerCommunicator.SendRequest(new { type = "get_website_limits" }, token);
        }

        private static void OnWebsiteLimitsMessage(JsonElement root)
        {
            var limits = new List<WebsiteLimit>();

            if (root.TryGetProperty("limits", out var arr))
            {
                foreach (var item in arr.EnumerateArray())
                {
                    limits.Add(new WebsiteLimit
                    {
                        domain = item.GetProperty("domain").GetString(),
                        dailyLimitMinutes = item.GetProperty("dailyLimitMinutes").GetInt32(),
                    });
                }
            }

            lock (_lock)
            {
                _websiteLimits = limits;
            }

            Logger.Log($"TabActivityStore: received {limits.Count} website limit(s) from server");
        }

        private static async Task DomainUsageLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try { RecomputeDomainUsage(); }
                catch (Exception ex) { Logger.Log($"TabActivityStore: domain usage recompute failed - {ex.Message}"); }

                try { await Task.Delay(TimeSpan.FromSeconds(DomainUsageRecomputeSeconds), token); }
                catch (TaskCanceledException) { break; }
            }
        }

        // The "real tab usage" calculation: clips today's tab events to the
        // intervals where a known browser was actually focused (per
        // AppActivityStore), then sums the overlap per domain. Deliberately a full
        // recompute from the raw event streams each time, not an incremental
        // tally - see class doc for why. Recomputed on a timer (not on every tab
        // event) since it's the one non-trivial calculation in this whole
        // pipeline; 3 minutes keeps it far off the hot path while still being
        // fresh enough for the extension's own 3-minute limit check.
        private static void RecomputeDomainUsage()
        {
            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            long dayStart = new DateTimeOffset(DateTime.Now.Date).ToUnixTimeMilliseconds();

            var browserIntervals = new List<(long Start, long End)>();
            foreach (var ev in AppActivityStore.GetEvents())
            {
                if (string.IsNullOrEmpty(ev.App.exeName) || !BrowserExeNames.Contains(ev.App.exeName))
                    continue;
                long s = Math.Max(ev.StartTime, dayStart);
                long e = Math.Min(ev.EndTime, now);
                if (s < e) browserIntervals.Add((s, e));
            }
            if (AppActivityStore.TryGetCurrentApp(out Application currentApp, out long appSwitchTime) &&
                !string.IsNullOrEmpty(currentApp.exeName) && BrowserExeNames.Contains(currentApp.exeName))
            {
                long s = Math.Max(appSwitchTime, dayStart);
                if (s < now) browserIntervals.Add((s, now));
            }
            var mergedFocus = MergeIntervals(browserIntervals);

            var tabIntervals = new List<(string Domain, long Start, long End)>();
            foreach (var ev in GetEvents())
            {
                long s = Math.Max(ev.StartTime, dayStart);
                long e = Math.Min(ev.EndTime, now);
                if (s < e) tabIntervals.Add((DomainOf(ev.Url), s, e));
            }
            if (TryGetCurrentTab(out string curUrl, out _, out long tabSwitchTime) && !string.IsNullOrEmpty(curUrl))
            {
                long s = Math.Max(tabSwitchTime, dayStart);
                if (s < now) tabIntervals.Add((DomainOf(curUrl), s, now));
            }

            var domainSeconds = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            foreach (var (domain, start, end) in tabIntervals)
            {
                foreach (var (focusStart, focusEnd) in mergedFocus)
                {
                    long cs = Math.Max(start, focusStart);
                    long ce = Math.Min(end, focusEnd);
                    if (cs >= ce) continue;

                    int seconds = (int)((ce - cs) / 1000);
                    domainSeconds.TryGetValue(domain, out int existing);
                    domainSeconds[domain] = existing + seconds;
                }
            }

            lock (_lock)
            {
                _domainUsageSeconds = domainSeconds;
            }
        }

        // Sorts by start and merges overlapping/adjacent ranges - same technique
        // as react-client/src/screens/ScreenTime.jsx's mergeIntervals.
        private static List<(long Start, long End)> MergeIntervals(List<(long Start, long End)> intervals)
        {
            var sorted = intervals.OrderBy(iv => iv.Start).ToList();
            var merged = new List<(long Start, long End)>();
            foreach (var iv in sorted)
            {
                if (merged.Count > 0 && iv.Start <= merged[merged.Count - 1].End)
                {
                    var last = merged[merged.Count - 1];
                    merged[merged.Count - 1] = (last.Start, Math.Max(last.End, iv.End));
                }
                else
                {
                    merged.Add(iv);
                }
            }
            return merged;
        }

        private static string DomainOf(string url)
        {
            if (string.IsNullOrEmpty(url))
                return url ?? "";
            try { return new Uri(url).Host; }
            catch { return url; }
        }
    }
}
