using System;
using trayapp.Structs;
using TrayApp;

namespace trayapp
{
    /// <summary>
    /// Owns the "previous app used" session state that used to live inside
    /// ServerCommunicator. Registers with WindowChangedListener directly and, once
    /// a completed session clears the debounce window, reports it to every
    /// subsystem that needs it (currently ServerCommunicator, to relay to the
    /// server, and ScreenTimeEnforcer, to tally local usage) - hardcoded for now,
    /// same as the two-listener pattern elsewhere in this app.
    /// </summary>
    internal static class PreviousAppUsedTracker
    {
        // Switches shorter than this aren't reported - filters out quick alt-tab
        // flicks that aren't real usage.
        private static readonly long MinSessionMs = 1000;

        private static Application _currentApp;
        private static long _currentStartMs;
        private static bool _hasCurrent;
        private static readonly object _sessionLock = new object();

        public static void Start()
        {
            IntPtr initial = WindowChangedListener.GetCurrentForegroundWindow();
            if (initial != IntPtr.Zero)
            {
                lock (_sessionLock)
                {
                    _currentApp = ApplicationResolver.Resolve(initial);
                    _currentStartMs = NowUnixMs();
                    _hasCurrent = true;
                }
            }

            WindowChangedListener.RegisterCallback(OnWindowChanged);
        }

        private static void OnWindowChanged(IntPtr hwnd)
        {
            long now = NowUnixMs();
            Application switchedTo = ApplicationResolver.Resolve(hwnd);

            Application previous = default;
            long startTime = 0;
            long endTime = 0;
            bool hasSession = false;

            lock (_sessionLock)
            {
                if (_hasCurrent && now - _currentStartMs >= MinSessionMs)
                {
                    previous = _currentApp;
                    startTime = _currentStartMs;
                    endTime = now;
                    hasSession = true;
                }

                _currentApp = switchedTo;
                _currentStartMs = now;
                _hasCurrent = true;
            }

            if (!hasSession)
                return;

            ServerCommunicator.ReportAppSession(previous, startTime, endTime);
            ScreenTimeEnforcer.ReportAppSession(previous, startTime, endTime);
        }

        private static long NowUnixMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
    }
}
