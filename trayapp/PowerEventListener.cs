using Microsoft.Win32;
using trayapp.Structs;
using TrayApp;

namespace trayapp
{
    // Feeds synthetic app switches into PreviousAppUsedTracker for transitions the
    // foreground-window hook (WindowChangedListener) can't reliably see on its own:
    // the lock screen usually does produce a real EVENT_SYSTEM_FOREGROUND, but isn't
    // guaranteed to, and suspend/resume produces none at all (no window ever gets
    // focus while the machine is asleep). Without this, whatever app was focused
    // before a lock or sleep keeps "running" for the entire locked/suspended
    // duration once the machine wakes, since nothing ever closes out its session.
    //
    // Represented as synthetic apps (LockApp/Sleep) rather than a new session/event
    // type, so every existing consumer of app sessions - usage tallies, limits, the
    // browser-focus clamp, server-side Event rows - handles them for free: they're
    // just apps nobody has configured a limit on.
    internal static class PowerEventListener
    {
        // Matches the exeName Windows' own lock screen process reports as
        // (LockApp.exe, ProcessName strips the extension) - reusing it means a lock
        // caught here and one caught by a real foreground-hook event (which does
        // still fire for most lock/unlock transitions) collapse into the same
        // bucket instead of counting as two different apps.
        private const string LockAppExeName = "LockApp";

        // Not a real process - there's nothing "focused" while the machine is
        // suspended, so this is purely a placeholder exeName to occupy the current-
        // app slot for the suspended duration.
        private const string SleepExeName = "Sleep";

        private static bool _started;

        public static void Start()
        {
            if (_started)
                return;
            _started = true;

            SystemEvents.SessionSwitch += OnSessionSwitch;
            SystemEvents.PowerModeChanged += OnPowerModeChanged;
        }

        private static void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
        {
            switch (e.Reason)
            {
                case SessionSwitchReason.SessionLock:
                    Logger.Log("PowerEventListener: session locked");
                    PreviousAppUsedTracker.ForceSwitch(SyntheticApp(LockAppExeName));
                    break;
                case SessionSwitchReason.SessionUnlock:
                    Logger.Log("PowerEventListener: session unlocked");
                    PreviousAppUsedTracker.ForceSwitch(WindowChangedListener.GetCurrentApplication());
                    break;
            }
        }

        private static void OnPowerModeChanged(object sender, PowerModeChangedEventArgs e)
        {
            switch (e.Mode)
            {
                case PowerModes.Suspend:
                    Logger.Log("PowerEventListener: system suspending");
                    PreviousAppUsedTracker.ForceSwitch(SyntheticApp(SleepExeName));
                    break;
                case PowerModes.Resume:
                    Logger.Log("PowerEventListener: system resumed");
                    PreviousAppUsedTracker.ForceSwitch(WindowChangedListener.GetCurrentApplication());
                    break;
            }
        }

        private static Application SyntheticApp(string exeName)
        {
            return new Application
            {
                exeName = exeName,
                fileDescription = "",
                path = "",
                pid = 0
            };
        }
    }
}
