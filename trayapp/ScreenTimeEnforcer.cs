using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using trayapp.Structs;
using TrayApp;

namespace trayapp
{
    // Syncs per-app daily limits and today's per-app usage from the server, and
    // tracks which apps are currently over their daily limit.
    internal static class ScreenTimeEnforcer
    {
        private const int ConfigurationReloadSeconds = 20; // 5 minutes

        private static readonly object _lock = new object();
        private static List<AppLimit> _appLimits = new List<AppLimit>();
        // exeName -> seconds used today (see server.py _build_app_usage_payload).
        private static Dictionary<string, int> _appUsageSeconds =
            new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        private static HashSet<string> _exceededApps =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private static CancellationTokenSource _cts;

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
        }

        public static List<AppLimit> GetAppLimits()
        {
            lock (_lock)
            {
                return new List<AppLimit>(_appLimits);
            }
        }

        // exeName -> seconds used today, as last reported by the server.
        public static Dictionary<string, int> GetAppUsageSeconds()
        {
            lock (_lock)
            {
                return new Dictionary<string, int>(_appUsageSeconds, StringComparer.OrdinalIgnoreCase);
            }
        }

        public static bool IsOverLimit(string exeName)
        {
            if (string.IsNullOrEmpty(exeName))
                return false;

            lock (_lock)
            {
                return _exceededApps.Contains(exeName);
            }
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

            lock (_lock)
            {
                _appLimits = limits;
            }

            Logger.Log($"ScreenTimeEnforcer: received {limits.Count} app limit(s) from server");
            RecomputeExceeded();
        }

        private static void OnAppUsageMessage(JsonElement root)
        {
            var usage = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

            if (root.TryGetProperty("usage", out var usageObj))
            {
                foreach (var prop in usageObj.EnumerateObject())
                    usage[prop.Name] = prop.Value.GetInt32();
            }

            lock (_lock)
            {
                _appUsageSeconds = usage;
            }

            Logger.Log($"ScreenTimeEnforcer: received usage for {usage.Count} app(s) from server");
            RecomputeExceeded();
        }

        // Usage is keyed by exeName only (the server aggregates it that way), so
        // matching against a limit here is by exeName - not by path, unlike
        // identifying which Application row a limit belongs to (see AppLimit.path).
        private static void RecomputeExceeded()
        {
            List<AppLimit> limits;
            Dictionary<string, int> usage;
            lock (_lock)
            {
                limits = _appLimits;
                usage = _appUsageSeconds;
            }

            var exceeded = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var limit in limits)
            {
                if (string.IsNullOrEmpty(limit.exeName))
                    continue;

                int usedSeconds = usage.TryGetValue(limit.exeName, out var seconds) ? seconds : 0;
                if (usedSeconds >= limit.dailyLimitMinutes * 60)
                    exceeded.Add(limit.exeName);
            }

            HashSet<string> newlyExceeded;
            lock (_lock)
            {
                newlyExceeded = new HashSet<string>(exceeded, StringComparer.OrdinalIgnoreCase);
                newlyExceeded.ExceptWith(_exceededApps);
                _exceededApps = exceeded;
            }

            foreach (var exeName in newlyExceeded)
                Logger.Log($"ScreenTimeEnforcer: {exeName} has reached its daily limit");
        }
    }
}
