using System;
using System.Collections.Generic;
using trayapp.Structs;

namespace trayapp
{
    // Single source of truth for app activity - mirrors TabActivityStore's shape
    // on the app side: the events table, the currently-focused app, today's
    // per-app usage tally, and the daily limits synced from the server. Fed by
    // PreviousAppUsedTracker (RecordSwitch) and ScreenTimeEnforcer (usage/limit
    // syncing, IsOverLimit checks) - ScreenTimeEnforcer itself only holds
    // enforcement/networking logic, not state.
    internal static class AppActivityStore
    {
        internal struct AppEvent
        {
            public Application App;
            public long StartTime;
            public long EndTime;
        }

        private static readonly object _lock = new object();
        private static readonly List<AppEvent> _events = new List<AppEvent>();
        private static Dictionary<string, int> _appUsageSeconds =
            new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        private static List<AppLimit> _appLimits = new List<AppLimit>();

        private static Application _currentApp;
        private static long _currentAppSwitchTime;
        private static bool _hasCurrentApp;

        // Called by PreviousAppUsedTracker for every completed app session -
        // appends the finished session to the events table and updates which app
        // is currently focused.
        public static void RecordSwitch(AppSwitchedEvent evt)
        {
            lock (_lock)
            {
                _events.Add(new AppEvent
                {
                    App = evt.Previous,
                    StartTime = evt.StartTime,
                    EndTime = evt.EndTime
                });

                _currentApp = evt.Current;
                _currentAppSwitchTime = evt.EndTime;
                _hasCurrentApp = true;
            }
        }

        public static List<AppEvent> GetEvents()
        {
            lock (_lock)
            {
                return new List<AppEvent>(_events);
            }
        }

        public static bool TryGetCurrentApp(out Application app, out long switchTime)
        {
            lock (_lock)
            {
                app = _currentApp;
                switchTime = _currentAppSwitchTime;
                return _hasCurrentApp;
            }
        }

        // exeName -> seconds used today.
        public static void AddUsageSeconds(string exeName, int seconds)
        {
            if (string.IsNullOrEmpty(exeName) || seconds <= 0)
                return;

            lock (_lock)
            {
                _appUsageSeconds.TryGetValue(exeName, out int existing);
                _appUsageSeconds[exeName] = existing + seconds;
            }
        }

        // Overwrites the whole usage table - used when the server pushes today's
        // authoritative usage (see ScreenTimeEnforcer.OnAppUsageMessage).
        public static void SetUsageSeconds(Dictionary<string, int> usage)
        {
            lock (_lock)
            {
                _appUsageSeconds = new Dictionary<string, int>(usage, StringComparer.OrdinalIgnoreCase);
            }
        }

        public static Dictionary<string, int> GetUsageSeconds()
        {
            lock (_lock)
            {
                return new Dictionary<string, int>(_appUsageSeconds, StringComparer.OrdinalIgnoreCase);
            }
        }

        public static void ResetUsageSeconds()
        {
            lock (_lock)
            {
                _appUsageSeconds = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            }
        }

        // Stored usage only reflects sessions that have actually ended (flushed by
        // RecordSwitch/AddUsageSeconds on the next switch) - an app sitting focused
        // for the last 10 minutes wouldn't show any of that time yet. This adds the
        // in-progress duration of the currently-focused app on top, live, without
        // persisting it - so enforcement (IsOverLimit) sees up-to-date usage without
        // waiting for a window switch to flush it.
        public static int GetEffectiveUsageSeconds(string exeName)
        {
            if (string.IsNullOrEmpty(exeName))
                return 0;

            lock (_lock)
            {
                _appUsageSeconds.TryGetValue(exeName, out int seconds);

                if (_hasCurrentApp && string.Equals(_currentApp.exeName, exeName, StringComparison.OrdinalIgnoreCase))
                {
                    long liveMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - _currentAppSwitchTime;
                    if (liveMs > 0)
                        seconds += (int)(liveMs / 1000);
                }

                return seconds;
            }
        }

        public static void SetAppLimits(List<AppLimit> limits)
        {
            lock (_lock)
            {
                _appLimits = limits;
            }
        }

        public static List<AppLimit> GetAppLimits()
        {
            lock (_lock)
            {
                return new List<AppLimit>(_appLimits);
            }
        }

        public static void ResetAppLimits()
        {
            lock (_lock)
            {
                _appLimits = new List<AppLimit>();
            }
        }

        // Usage is keyed by exeName only (the server aggregates it that way), so
        // matching against a limit here is by exeName - not by path, unlike
        // identifying which Application row a limit belongs to (see AppLimit.path).
        public static bool IsOverLimit(string exeName)
        {
            if (string.IsNullOrEmpty(exeName))
                return false;

            List<AppLimit> limits;
            lock (_lock)
            {
                limits = _appLimits;
            }

            foreach (var limit in limits)
            {
                if (!string.Equals(limit.exeName, exeName, StringComparison.OrdinalIgnoreCase))
                    continue;

                return GetEffectiveUsageSeconds(exeName) >= limit.dailyLimitMinutes * 60;
            }

            return false;
        }
    }
}
