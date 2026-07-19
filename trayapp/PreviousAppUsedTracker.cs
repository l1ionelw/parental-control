using System;
using trayapp.Structs;
using TrayApp;

namespace trayapp
{
    /// <summary>
    /// Owns the "previous app used" session state that used to live inside
    /// ServerCommunicator. Registers with WindowChangedListener directly. Every
    /// switch, no matter how short, updates the live "current app" state
    /// (AppActivityStore, ScreenTimeEnforcer's limit check) and is relayed to the
    /// server - so both stay in sync with what's actually focused right now.
    /// Persisting the *finished* session as history/usage (locally and
    /// server-side) is a separate decision gated by MinSessionMs, filtering out
    /// alt-tab flicker without delaying real-time state.
    /// </summary>
    internal static class PreviousAppUsedTracker
    {
        // Finished sessions shorter than this aren't persisted into history/usage -
        // filters out quick alt-tab flicks that aren't real usage. Does NOT gate
        // whether a switch is reported at all (see OnWindowChanged).
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
                AppActivityStore.SetCurrentApp(_currentApp, _currentStartMs);

                // Seeds the server's open_app_sessions cache immediately, instead of
                // leaving it empty until the first real switch away from this app -
                // otherwise a long-running first session (e.g. the machine sits on
                // one app for hours right after the trayapp starts) wouldn't show up
                // live in /api/screentime until it finally ends. 'previous' is left
                // default (StartTime == EndTime, i.e. zero duration) so the server's
                // existing debounce write-gate treats it as a no-op for persistence -
                // it only updates the current-app cache, same as every other switch.
                var initialEvt = new AppSwitchedEvent
                {
                    Previous = default,
                    StartTime = _currentStartMs,
                    EndTime = _currentStartMs,
                    Current = _currentApp
                };
                ServerCommunicator.ReportAppSession(initialEvt);
            }

            WindowChangedListener.RegisterCallback(OnWindowChanged);
        }

        private static void OnWindowChanged(IntPtr hwnd)
        {
            long now = NowUnixMs();
            Application switchedTo = ApplicationResolver.Resolve(hwnd);

            Application previous;
            long startTime;
            bool hasPrevious;

            lock (_sessionLock)
            {
                hasPrevious = _hasCurrent;
                previous = _currentApp;
                startTime = _currentStartMs;

                _currentApp = switchedTo;
                _currentStartMs = now;
                _hasCurrent = true;
            }

            // Always kept live, regardless of MinSessionMs below - the server and
            // AppActivityStore need to reflect what's actually focused right now,
            // not lag behind the debounce that only gates *persisted* history.
            AppActivityStore.SetCurrentApp(switchedTo, now);
            ScreenTimeEnforcer.CheckAppLimit(switchedTo);

            if (!hasPrevious)
                return; // nothing finished yet - this is the very first window seen

            long endTime = now;
            var evt = new AppSwitchedEvent
            {
                Previous = previous,
                StartTime = startTime,
                EndTime = endTime,
                Current = switchedTo
            };

            // The server gets every switch, even sub-debounce ones, so its own
            // "current app" cache stays live (mirrors AppActivityStore.SetCurrentApp
            // above). Whether it persists 'previous' as history is the server's
            // own duration check, same MinSessionMs threshold as here.
            ServerCommunicator.ReportAppSession(evt);

            if (endTime - startTime < MinSessionMs)
                return;

            ScreenTimeEnforcer.ReportAppSession(evt);
            AppActivityStore.RecordEvent(evt.Previous, evt.StartTime, evt.EndTime);
        }

        private static long NowUnixMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
    }
}
