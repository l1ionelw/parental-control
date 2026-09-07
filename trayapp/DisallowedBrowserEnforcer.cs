using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using trayapp.Structs;
using TrayApp;

namespace trayapp
{
    /// <summary>
    /// Admin-configured per-device list of browsers that may never be focused -
    /// a brand-new enforcement mechanism, not AppLimit/dailyLimitMinutes=0, since
    /// that requires an existing Application catalog row that a browser never run
    /// on this device wouldn't have. Passive cache synced like AlwaysAllowedApps
    /// (fetch on connect, clear on disconnect); proactive enforcement hooked into
    /// WindowChangedListener like ManualBlockEnforcer/DowntimeEnforcer. Matches by
    /// exeName + a path substring together (not exe name alone), since some
    /// browsers share generic exe names (chrome.exe: Chrome vs Chromium;
    /// launcher.exe/browser.exe: Opera GX, Yandex, Coc Coc).
    /// </summary>
    internal static class DisallowedBrowserEnforcer
    {
        private static readonly object _lock = new object();
        private static List<DisallowedBrowser> _disallowed = new List<DisallowedBrowser>();
        private static bool _subscribed;

        public static void Start()
        {
            Logger.Log("DisallowedBrowserEnforcer: starting");
            ServerCommunicator.RegisterMessageHandler("disallowed_browsers", OnDisallowedBrowsersMessage);

            if (!_subscribed)
            {
                // WindowChangedListener has no unregister, so subscribe once ever -
                // same pattern as ManualBlockEnforcer.
                WindowChangedListener.RegisterCallback(OnWindowChanged);
                _subscribed = true;
            }
        }

        // Called by ServerCommunicator once the server connection (re)establishes -
        // there's no periodic reload for this one (the list only changes when an
        // admin edits it, not on a schedule), just a fetch on (re)connect, same as
        // AlwaysAllowedApps.
        public static void ManualReload()
        {
            if (!ServerCommunicator.IsConnected)
            {
                Logger.Log("DisallowedBrowserEnforcer: server not connected, skipping config fetch");
                return;
            }

            _ = ServerCommunicator.SendRequest(new { type = "get_disallowed_browsers" }, CancellationToken.None);
        }

        // Called by ServerCommunicator when the server connection drops - clears
        // synced state, since it may now be stale.
        public static void Deactivate()
        {
            Logger.Log("DisallowedBrowserEnforcer: deactivating, clearing state");
            lock (_lock)
            {
                _disallowed = new List<DisallowedBrowser>();
            }
        }

        private static bool IsDisallowed(string exeName, string path)
        {
            if (string.IsNullOrEmpty(exeName))
                return false;

            lock (_lock)
            {
                foreach (var browser in _disallowed)
                {
                    bool exeMatches = browser.exeNamePartial
                        ? exeName.IndexOf(browser.exeName ?? "", StringComparison.OrdinalIgnoreCase) >= 0
                        : string.Equals(browser.exeName, exeName, StringComparison.OrdinalIgnoreCase);
                    if (!exeMatches)
                        continue;

                    if (string.IsNullOrEmpty(browser.pathSubstring))
                        return true;

                    if (!string.IsNullOrEmpty(path) &&
                        path.IndexOf(browser.pathSubstring, StringComparison.OrdinalIgnoreCase) >= 0)
                        return true;
                }
            }

            return false;
        }

        private static void OnWindowChanged(IntPtr hwnd, long seq)
        {
            var app = ApplicationResolver.Resolve(hwnd);
            if (!IsDisallowed(app.exeName, app.path))
                return;

            Logger.Log($"DisallowedBrowserEnforcer: {app.exeName} ({app.path}) is a disallowed browser, terminating (pid={app.pid})");
            ProcessTerminationManager.TerminateProcess(
                app.pid,
                $"{app.exeName} is not an allowed browser on this device.");
        }

        private static void OnDisallowedBrowsersMessage(JsonElement root)
        {
            var browsers = new List<DisallowedBrowser>();

            if (root.TryGetProperty("browsers", out var arr))
            {
                foreach (var item in arr.EnumerateArray())
                {
                    browsers.Add(new DisallowedBrowser
                    {
                        id = item.TryGetProperty("id", out var idProp) ? idProp.GetString() : "",
                        exeName = item.TryGetProperty("exeName", out var exeProp) ? exeProp.GetString() : "",
                        pathSubstring = item.TryGetProperty("pathSubstring", out var pathProp) ? pathProp.GetString() : "",
                        exeNamePartial = item.TryGetProperty("exeNamePartial", out var partialProp) && partialProp.GetBoolean(),
                    });
                }
            }

            lock (_lock)
            {
                _disallowed = browsers;
            }

            Logger.Log($"DisallowedBrowserEnforcer: received {browsers.Count} disallowed browser(s) from server");
        }
    }
}
