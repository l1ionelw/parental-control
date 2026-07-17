using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using trayapp.Structs;
using TrayApp;

namespace trayapp
{
    // Syncs the device's downtime windows from the server and tracks whether the
    // device is currently inside one of them.
    internal static class DowntimeEnforcer
    {
        private const int ConfigurationReloadSeconds = 20; // 5 minutes
        private const int EnforcementCheckSeconds = 60; // check the clock once a minute

        private static readonly object _lock = new object();
        private static List<DowntimeWindow> _downtimes = new List<DowntimeWindow>();
        private static bool _isInDowntime;
        private static CancellationTokenSource _cts;

        public static void Start()
        {
            Logger.Log("DowntimeEnforcer: starting");
            _cts = new CancellationTokenSource();

            ServerCommunicator.RegisterMessageHandler("downtime", OnDowntimeMessage);

            _ = Task.Run(() => ReloadLoop(_cts.Token));
            _ = Task.Run(() => EnforcementLoop(_cts.Token));
        }

        public static void Stop()
        {
            _cts?.Cancel();
        }

        public static List<DowntimeWindow> GetDowntimes()
        {
            lock (_lock)
            {
                return new List<DowntimeWindow>(_downtimes);
            }
        }

        public static bool IsInDowntime()
        {
            lock (_lock)
            {
                return _isInDowntime;
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
                Logger.Log("DowntimeEnforcer: server not connected, skipping config fetch");
                return;
            }

            await ServerCommunicator.SendRequest(new { type = "get_downtime" }, token);
        }

        private static async Task EnforcementLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                CheckDowntimeState();

                try { await Task.Delay(TimeSpan.FromSeconds(EnforcementCheckSeconds), token); }
                catch (TaskCanceledException) { break; }
            }
        }

        private static void CheckDowntimeState()
        {
            List<DowntimeWindow> downtimes;
            lock (_lock)
            {
                downtimes = _downtimes;
            }

            int nowMinute = DateTime.Now.Hour * 60 + DateTime.Now.Minute;
            bool inDowntime = false;
            foreach (var window in downtimes)
            {
                if (window.enabled && IsMinuteInWindow(nowMinute, window.startMinute, window.endMinute))
                {
                    inDowntime = true;
                    break;
                }
            }

            bool changed;
            lock (_lock)
            {
                changed = inDowntime != _isInDowntime;
                _isInDowntime = inDowntime;
            }

            if (changed)
                Logger.Log(inDowntime ? "DowntimeEnforcer: entering downtime" : "DowntimeEnforcer: exiting downtime");
        }

        // startMinute/endMinute are minutes-since-midnight (0-1439). A window can
        // wrap past midnight (e.g. 22:00-07:00), so equal bounds means "no window"
        // rather than "all day".
        private static bool IsMinuteInWindow(int minute, int startMinute, int endMinute)
        {
            if (startMinute == endMinute)
                return false;

            if (startMinute < endMinute)
                return minute >= startMinute && minute < endMinute;

            return minute >= startMinute || minute < endMinute;
        }

        private static void OnDowntimeMessage(JsonElement root)
        {
            var downtimes = new List<DowntimeWindow>();

            if (root.TryGetProperty("downtimes", out var arr))
            {
                foreach (var item in arr.EnumerateArray())
                {
                    downtimes.Add(new DowntimeWindow
                    {
                        id = item.GetProperty("id").GetInt32(),
                        startMinute = item.GetProperty("startMinute").GetInt32(),
                        endMinute = item.GetProperty("endMinute").GetInt32(),
                        enabled = item.GetProperty("enabled").GetBoolean(),
                    });
                }
            }

            lock (_lock)
            {
                _downtimes = downtimes;
            }

            Logger.Log($"DowntimeEnforcer: received {downtimes.Count} downtime window(s) from server");

            // Config just changed - re-evaluate immediately instead of waiting for
            // the next minute tick.
            CheckDowntimeState();
        }
    }
}
