using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using TrayApp;

namespace trayapp
{
    // Single source of truth for tab/website activity, fed by LocalExtensionServer
    // on behalf of the chrome extension (which used to hold and report all of this
    // itself, straight to the remote server - see chrome-extension/background.js).
    // Holds the events table, the currently-active tab, and a running per-URL
    // usage tally, and relays every switch/heartbeat up to the remote server via
    // ServerCommunicator so nothing changes for that side of the wire.
    internal static class TabActivityStore
    {
        // If the extension hasn't heartbeated (or switched tabs) in this long, the
        // browser has likely closed without a final event (service worker killed,
        // Chrome exited, etc.) - the watchdog loop below closes out the current
        // tab on this basis.
        private static readonly long HeartbeatTimeoutMs = 3 * 60 * 1000;
        private static readonly int WatchdogTickSeconds = 30;

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
            _ = Task.Run(() => WatchdogLoop(_cts.Token));
        }

        public static void Stop()
        {
            _cts?.Cancel();
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
    }
}
