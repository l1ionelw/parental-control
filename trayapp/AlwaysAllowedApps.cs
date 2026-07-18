using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using trayapp.Structs;
using TrayApp;

namespace trayapp
{
    /// <summary>
    /// Apps that no enforcement (downtime, screen-time limit, or manual block) is
    /// allowed to terminate - admin-configured per device on the server. Synced the
    /// same way DowntimeEnforcer/ScreenTimeEnforcer sync their config (on connect,
    /// cleared on disconnect), but purely a data cache: it has no enforcement loop
    /// of its own, just IsAlwaysAllowed(), consulted by ProcessTerminationManager.
    /// </summary>
    internal static class AlwaysAllowedApps
    {
        private static readonly object _lock = new object();
        private static List<AlwaysAllowedApp> _apps = new List<AlwaysAllowedApp>();

        public static void Start()
        {
            Logger.Log("AlwaysAllowedApps: starting");
            ServerCommunicator.RegisterMessageHandler("block_exceptions", OnBlockExceptionsMessage);
        }

        // Called by ServerCommunicator once the server connection (re)establishes -
        // there's no periodic reload for this one, just a fetch on (re)connect.
        public static void ManualReload()
        {
            if (!ServerCommunicator.IsConnected)
            {
                Logger.Log("AlwaysAllowedApps: server not connected, skipping config fetch");
                return;
            }

            _ = ServerCommunicator.SendRequest(new { type = "get_block_exceptions" }, CancellationToken.None);
        }

        // Called by ServerCommunicator when the server connection drops - clears
        // synced state, since it may now be stale.
        public static void Deactivate()
        {
            Logger.Log("AlwaysAllowedApps: deactivating, clearing state");
            lock (_lock)
            {
                _apps = new List<AlwaysAllowedApp>();
            }
        }

        public static bool IsAlwaysAllowed(string exeName)
        {
            if (string.IsNullOrEmpty(exeName))
                return false;

            lock (_lock)
            {
                foreach (var app in _apps)
                {
                    if (string.Equals(app.exeName, exeName, StringComparison.OrdinalIgnoreCase))
                        return true;
                }
            }

            return false;
        }

        private static void OnBlockExceptionsMessage(JsonElement root)
        {
            var apps = new List<AlwaysAllowedApp>();

            if (root.TryGetProperty("exceptions", out var arr))
            {
                foreach (var item in arr.EnumerateArray())
                {
                    var allPaths = new List<string>();
                    if (item.TryGetProperty("allPaths", out var pathsArr))
                    {
                        foreach (var p in pathsArr.EnumerateArray())
                            allPaths.Add(p.GetString());
                    }

                    apps.Add(new AlwaysAllowedApp
                    {
                        appId = item.GetProperty("appId").GetInt32(),
                        exeName = item.GetProperty("exeName").GetString(),
                        fileDescription = item.GetProperty("fileDescription").GetString(),
                        path = item.GetProperty("path").GetString(),
                        allPaths = allPaths.ToArray(),
                    });
                }
            }

            lock (_lock)
            {
                _apps = apps;
            }

            Logger.Log($"AlwaysAllowedApps: received {apps.Count} always-allowed app(s) from server");
        }
    }
}
