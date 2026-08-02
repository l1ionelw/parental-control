using System;
using System.Threading;
using System.Threading.Tasks;
using TrayApp;

namespace trayapp
{
    /// <summary>
    /// Admin-triggered "block this device right now" - purely a runtime on/off
    /// flag, driven entirely by ServerCommunicator (see its "manual_block" message
    /// handler). Not persisted anywhere on this side either, matching the server's
    /// in-memory-only manual block state (server.py manual_block.py): a restart of
    /// either side just re-syncs from scratch on the next connect.
    /// </summary>
    internal static class ManualBlockEnforcer
    {
        private const int PollSeconds = 60;

        private static readonly object _lock = new object();
        private static bool _enabled;
        private static long? _endTimeMs;
        private static bool _subscribed;
        private static CancellationTokenSource _cts;

        // For other classes to check whether manual block is currently active -
        // nothing checks this yet, but it's the intended integration point.
        public static bool IsEnabled()
        {
            lock (_lock)
            {
                return _enabled;
            }
        }

        public static void Start(long? endTimeMs)
        {
            lock (_lock)
            {
                _enabled = true;
                _endTimeMs = endTimeMs;

                if (!_subscribed)
                {
                    // WindowChangedListener has no unregister, so subscribe once
                    // ever and let the callback gate on _enabled itself instead of
                    // subscribing/unsubscribing on every Start/Stop cycle.
                    WindowChangedListener.RegisterCallback(OnWindowChanged);
                    _subscribed = true;
                }

                if (_cts != null && !_cts.IsCancellationRequested)
                    return; // poll loop already running

                Logger.Log("ManualBlockEnforcer: starting");
                _cts = new CancellationTokenSource();
                _ = Task.Run(() => PollLoop(_cts.Token));
            }
        }

        public static void Stop()
        {
            CancellationTokenSource cts;
            lock (_lock)
            {
                Logger.Log("ManualBlockEnforcer: stopping");
                _enabled = false;
                _endTimeMs = null;
                cts = _cts;
                _cts = null;
            }

            cts?.Cancel();
        }

        private static void OnWindowChanged(IntPtr hwnd, long seq)
        {
            Enforce();
        }

        private static async Task PollLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                Enforce();

                try { await Task.Delay(TimeSpan.FromSeconds(PollSeconds), token); }
                catch (TaskCanceledException) { break; }
            }
        }

        private static void Enforce()
        {
            long? endTimeMs;
            lock (_lock)
            {
                if (!_enabled)
                    return;
                endTimeMs = _endTimeMs;
            }

            // The server only pushes an explicit unblock when an admin clears it or
            // on the next reconnect (see ServerCommunicator.OnManualBlockMessage) -
            // it does not proactively notify us when a timed block simply runs out.
            // So self-expire here rather than blocking forever at "0 minutes".
            if (endTimeMs.HasValue && endTimeMs.Value <= DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
            {
                Stop();
                return;
            }

            EnforceTerminate(endTimeMs);
        }

        private static void EnforceTerminate(long? endTimeMs)
        {
            string message = endTimeMs.HasValue
                ? $"This device is blocked for {RemainingMinutes(endTimeMs.Value)} more minute(s)."
                : "This device is currently blocked.";

            ProcessTerminationManager.TerminateForegroundProcess(message);
        }

        private static int RemainingMinutes(long endTimeMs)
        {
            long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            long remainingMs = endTimeMs - nowMs;
            return (int)Math.Max(0, Math.Ceiling(remainingMs / 60000.0));
        }
    }
}
