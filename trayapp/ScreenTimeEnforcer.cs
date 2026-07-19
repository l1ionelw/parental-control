using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using trayapp.Structs;
using TrayApp;

namespace trayapp
{
    // Syncs per-app daily limits and today's per-app usage from the server into
    // AppActivityStore, and enforces them by terminating the focused app once
    // it's over its limit. Holds no state of its own - see AppActivityStore.
    internal static class ScreenTimeEnforcer
    {
        private const int ConfigurationReloadSeconds = 20; // 5 minutes
        private const int EnforcementCheckSeconds = 60; // check the focused app once a minute

        private static readonly object _lock = new object();
        private static CancellationTokenSource _cts;

        // The raw window_changed events this app reports are timestamped and always
        // clamped correctly by the server when it aggregates "today's" usage (see
        // server.py _build_app_usage_payload) - but AppActivityStore's usage tally
        // is a running total with no such clamping, so without this it would keep
        // adding onto yesterday's numbers forever. Checked in ReportAppSession (a
        // session boundary crossing midnight) and once a minute in EnforcementLoop
        // (backstop for a machine idle on the same app across midnight, with no
        // session boundary to catch it).
        private static DateTime _currentDay = DateTime.Now.Date;

        // Separate from _cts: the per-minute "is the focused app over its limit"
        // check only runs while connected (see Activate/Deactivate), independent of
        // the reload loop's lifetime, which runs for as long as the app is running.
        private static CancellationTokenSource _enforcementCts;

        public static void Start()
        {
            Logger.Log("ScreenTimeEnforcer: starting");
            _cts = new CancellationTokenSource();

            ServerCommunicator.RegisterMessageHandler("app_limits", OnAppLimitsMessage);
            ServerCommunicator.RegisterMessageHandler("app_usage", OnAppUsageMessage);

            _ = Task.Run(() => ReloadLoop(_cts.Token));
        }

        public static void Stop()
        {
            _cts?.Cancel();
            _enforcementCts?.Cancel();
        }

        // Called by ServerCommunicator once the server connection (re)establishes -
        // starts the per-minute "is the focused app over its limit" check. No-op if
        // already running.
        public static void Activate()
        {
            if (_enforcementCts != null && !_enforcementCts.IsCancellationRequested)
                return;

            Logger.Log("ScreenTimeEnforcer: activating");
            _enforcementCts = new CancellationTokenSource();
            _ = Task.Run(() => EnforcementLoop(_enforcementCts.Token));
        }

        // Called by ServerCommunicator when the server connection drops - stops the
        // per-minute check and clears synced state, since it may now be stale.
        public static void Deactivate()
        {
            Logger.Log("ScreenTimeEnforcer: deactivating, clearing app limit state");
            _enforcementCts?.Cancel();

            AppActivityStore.ResetAppLimits();
            AppActivityStore.ResetUsageSeconds();
        }

        // Called by PreviousAppUsedTracker for every completed (i.e. past the
        // debounce window) app session - tallies the finished session's duration
        // onto today's usage for the *previous* app. Does NOT check the current
        // app's limit - PreviousAppUsedTracker calls CheckAppLimit for that on
        // every switch regardless of debounce (see its own comment).
        public static void ReportAppSession(AppSwitchedEvent evt)
        {
            if (!ServerCommunicator.IsConnected)
                return;

            // A session spanning midnight (e.g. 11:55pm -> 12:05am) would otherwise
            // have its *entire* duration - including yesterday's portion - added to
            // today's tally, double-counting against what the server's clamped
            // aggregation already knows about. On rollover, skip the local add for
            // this call entirely and let the forced resync below repopulate
            // AppActivityStore's usage from the server's correctly-clamped numbers
            // instead.
            if (!CheckDayRollover() && !string.IsNullOrEmpty(evt.Previous.exeName))
            {
                int usedSeconds = (int)((evt.EndTime - evt.StartTime) / 1000);
                if (usedSeconds > 0)
                    AppActivityStore.AddUsageSeconds(evt.Previous.exeName, usedSeconds);
            }
        }

        // Returns true (and triggers an immediate resync) if the local day has
        // rolled over since the last check.
        private static bool CheckDayRollover()
        {
            var today = DateTime.Now.Date;
            lock (_lock)
            {
                if (today == _currentDay)
                    return false;
                _currentDay = today;
            }

            Logger.Log("ScreenTimeEnforcer: day rolled over, forcing a full usage resync");
            var cts = _cts;
            if (cts != null)
                _ = Task.Run(() => ManualReload(cts.Token));
            return true;
        }

        private static async Task ReloadLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                await ManualReload(token);

                try { await Task.Delay(TimeSpan.FromSeconds(ConfigurationReloadSeconds), token); }
                catch (TaskCanceledException) { break; }
            }
        }

        // Exposed so ServerCommunicator can trigger an immediate fetch on connect/
        // reconnect instead of waiting up to ConfigurationReloadSeconds for the
        // periodic loop to get around to it.
        public static async Task ManualReload(CancellationToken token)
        {
            if (!ServerCommunicator.IsConnected)
            {
                Logger.Log("ScreenTimeEnforcer: server not connected, skipping config fetch");
                return;
            }

            await ServerCommunicator.SendRequest(new { type = "get_app_limits" }, token);
            await ServerCommunicator.SendRequest(new { type = "get_app_usage" }, token);
        }

        private static async Task EnforcementLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                CheckDayRollover();
                // No AppSwitchedEvent here (this is the periodic backstop, not a
                // switch), so resolve whatever's focused right now live.
                CheckAppLimit(WindowChangedListener.GetCurrentApplication());

                try { await Task.Delay(TimeSpan.FromSeconds(EnforcementCheckSeconds), token); }
                catch (TaskCanceledException) { break; }
            }
        }

        // Terminates 'current' (not the "previous" app from a session report) if
        // it's over its daily limit. Called on every window switch (regardless of
        // PreviousAppUsedTracker's debounce - a quick flick through a blocked app
        // shouldn't dodge enforcement just because it's too short to count as real
        // usage) as well as once a minute from EnforcementLoop. 'current' is always
        // already resolved by the caller, pid included, so termination doesn't need
        // to re-look-up the foreground window.
        public static void CheckAppLimit(Application current)
        {
            if (string.IsNullOrEmpty(current.exeName) || !ServerCommunicator.IsConnected)
                return;

            bool overLimit = AppActivityStore.IsOverLimit(current.exeName);
            int usedSeconds = AppActivityStore.GetEffectiveUsageSeconds(current.exeName);
            int? limitMinutes = null;
            foreach (var limit in AppActivityStore.GetAppLimits())
            {
                if (string.Equals(limit.exeName, current.exeName, StringComparison.OrdinalIgnoreCase))
                {
                    limitMinutes = limit.dailyLimitMinutes;
                    break;
                }
            }

            Logger.Log($"ScreenTimeEnforcer: checking {current.exeName} - used={usedSeconds}s limit={(limitMinutes.HasValue ? limitMinutes + "min" : "none")} overLimit={overLimit}");

            if (overLimit)
            {
                Logger.Log($"ScreenTimeEnforcer: {current.exeName} is over its daily limit, terminating (pid={current.pid})");
                ProcessTerminationManager.TerminateProcess(current.pid,
                    $"{current.exeName} has reached its daily time limit. It will be available again tomorrow.");
            }
        }

        private static void OnAppLimitsMessage(JsonElement root)
        {
            var limits = new List<AppLimit>();

            if (root.TryGetProperty("limits", out var arr))
            {
                foreach (var item in arr.EnumerateArray())
                {
                    var allPaths = new List<string>();
                    if (item.TryGetProperty("allPaths", out var pathsArr))
                    {
                        foreach (var p in pathsArr.EnumerateArray())
                            allPaths.Add(p.GetString());
                    }

                    limits.Add(new AppLimit
                    {
                        appId = item.GetProperty("appId").GetInt32(),
                        exeName = item.GetProperty("exeName").GetString(),
                        fileDescription = item.GetProperty("fileDescription").GetString(),
                        path = item.GetProperty("path").GetString(),
                        allPaths = allPaths.ToArray(),
                        dailyLimitMinutes = item.GetProperty("dailyLimitMinutes").GetInt32(),
                    });
                }
            }

            AppActivityStore.SetAppLimits(limits);

            Logger.Log($"ScreenTimeEnforcer: received {limits.Count} app limit(s) from server");
        }

        private static void OnAppUsageMessage(JsonElement root)
        {
            var usage = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

            if (root.TryGetProperty("usage", out var usageObj))
            {
                foreach (var prop in usageObj.EnumerateObject())
                    usage[prop.Name] = prop.Value.GetInt32();
            }

            AppActivityStore.SetUsageSeconds(usage);

            Logger.Log($"ScreenTimeEnforcer: received usage for {usage.Count} app(s) from server");
        }
    }
}
