using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
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
    //
    // SystemEvents.PowerModeChanged (the "main" power event) is authoritative when
    // it fires Suspend - that always means the machine genuinely went down, whether
    // via lid close, power button, or Start menu, so it's trusted on its own with
    // no further checks. But some machines have a broken/disabled lid-close action
    // (closing the lid just locks the session, or does nothing at all) and never
    // raise Suspend - the machine sits there fully awake with every program still
    // running. For that case we additionally watch the lid switch and the display
    // power state directly (GUID_LIDSWITCH_STATE_CHANGE / GUID_CONSOLE_DISPLAY_STATE
    // via RegisterPowerSettingNotification) as a second signal: if the main power
    // event still says "on" but the lid is closed or the display is off, we assume
    // the user has stepped away same as a real suspend. This second signal is only
    // consulted while the main event says "on" - if Suspend already fired we don't
    // second-guess it with lid/display state, since the machine can go down without
    // the lid ever closing (e.g. the power button), and we don't want a stale
    // "lid still open" reading to fight the authoritative signal.
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

        // True once SystemEvents.PowerModeChanged has told us the machine is
        // suspended and hasn't yet told us it resumed. While true, lid/display
        // notifications are ignored entirely (see class remarks).
        private static bool _mainSignalSuspended;

        // Whether our secondary signal (lid closed or display off) currently thinks
        // the user has stepped away. Only acted on while _mainSignalSuspended is
        // false. Tracked so we don't send a second ForceSwitch(Sleep) if e.g. the
        // lid closes and then the display separately reports off.
        private static bool _secondarySignalOff;

        private static PowerNotificationWindow _notificationWindow;

        public static void Start()
        {
            if (_started)
                return;
            _started = true;

            SystemEvents.SessionSwitch += OnSessionSwitch;
            SystemEvents.PowerModeChanged += OnPowerModeChanged;

            // Owns the hidden native window that receives WM_POWERBROADCAST - lid
            // switch and display state notifications aren't exposed by SystemEvents
            // and require a real HWND to register against.
            _notificationWindow = new PowerNotificationWindow(OnLidOrDisplayStateChanged);
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
                    _mainSignalSuspended = true;
                    PreviousAppUsedTracker.ForceSwitch(SyntheticApp(SleepExeName));
                    break;
                case PowerModes.Resume:
                    Logger.Log("PowerEventListener: system resumed");
                    _mainSignalSuspended = false;
                    _secondarySignalOff = false;
                    PreviousAppUsedTracker.ForceSwitch(WindowChangedListener.GetCurrentApplication());
                    break;
            }
        }

        // isOff = lid closed or display off. Only trusted while the main power
        // event still says the machine is on - see class remarks.
        private static void OnLidOrDisplayStateChanged(bool isOff, string reason)
        {
            if (_mainSignalSuspended)
                return; // main signal already authoritative - don't second-guess it

            if (isOff)
            {
                if (_secondarySignalOff)
                    return; // already treating this as "stepped away"
                _secondarySignalOff = true;
                Logger.Log($"PowerEventListener: assuming sleep via secondary signal ({reason})");
                PreviousAppUsedTracker.ForceSwitch(SyntheticApp(SleepExeName));
            }
            else
            {
                if (!_secondarySignalOff)
                    return; // wasn't in the secondary "off" state - nothing to undo
                _secondarySignalOff = false;
                Logger.Log($"PowerEventListener: assuming resume via secondary signal ({reason})");
                PreviousAppUsedTracker.ForceSwitch(WindowChangedListener.GetCurrentApplication());
            }
        }

        private static trayapp.Structs.Application SyntheticApp(string exeName)
        {
            return new trayapp.Structs.Application
            {
                exeName = exeName,
                fileDescription = "",
                path = "",
                pid = 0
            };
        }

        // Hidden message-only-style window that exists purely to receive
        // WM_POWERBROADCAST for the lid switch and console display state, neither
        // of which SystemEvents exposes. Tracks the two independently (lid vs.
        // display) and reports "off" if either currently says so, since a machine
        // with lid-close disabled may still turn its display off on a timeout, and
        // vice versa on external-display setups where the lid can close without the
        // display doing anything.
        private sealed class PowerNotificationWindow : NativeWindow
        {
            private const int WM_POWERBROADCAST = 0x0218;
            private const int PBT_POWERSETTINGCHANGE = 0x8013;

            private static readonly Guid GUID_LIDSWITCH_STATE_CHANGE =
                new Guid("BA3E0F4D-B817-4094-A2D1-D56379E6A0F3");
            private static readonly Guid GUID_CONSOLE_DISPLAY_STATE =
                new Guid("6FE69556-704A-47A0-8F24-C28D936FDA47");

            private readonly Action<bool, string> _onStateChanged;
            private bool _lidClosed;
            private bool _displayOff;

            [StructLayout(LayoutKind.Sequential)]
            private struct POWERBROADCAST_SETTING
            {
                public Guid PowerSetting;
                public uint DataLength;
                public byte Data;
            }

            [DllImport("user32.dll", SetLastError = true)]
            private static extern IntPtr RegisterPowerSettingNotification(
                IntPtr hRecipient, ref Guid PowerSettingGuid, int Flags);

            public PowerNotificationWindow(Action<bool, string> onStateChanged)
            {
                _onStateChanged = onStateChanged;

                var handle = new CreateParams
                {
                    Caption = "PowerEventListener-NotificationWindow",
                    Style = 0,
                    ExStyle = 0,
                    ClassStyle = 0,
                    Parent = IntPtr.Zero
                };
                CreateHandle(handle);

                var lidGuid = GUID_LIDSWITCH_STATE_CHANGE;
                var displayGuid = GUID_CONSOLE_DISPLAY_STATE;
                RegisterPowerSettingNotification(Handle, ref lidGuid, 0 /* DEVICE_NOTIFY_WINDOW_HANDLE */);
                RegisterPowerSettingNotification(Handle, ref displayGuid, 0 /* DEVICE_NOTIFY_WINDOW_HANDLE */);
            }

            protected override void WndProc(ref Message m)
            {
                if (m.Msg == WM_POWERBROADCAST && m.WParam.ToInt32() == PBT_POWERSETTINGCHANGE)
                {
                    var setting = Marshal.PtrToStructure<POWERBROADCAST_SETTING>(m.LParam);
                    byte state = setting.Data;

                    if (setting.PowerSetting == GUID_LIDSWITCH_STATE_CHANGE)
                    {
                        // 0 = closed, 1 = open
                        _lidClosed = state == 0;
                        _onStateChanged(_lidClosed || _displayOff, _lidClosed ? "lid closed" : "lid opened");
                    }
                    else if (setting.PowerSetting == GUID_CONSOLE_DISPLAY_STATE)
                    {
                        // 0 = off, 1 = on, 2 = dimmed - only "off" counts as stepped away
                        _displayOff = state == 0;
                        _onStateChanged(_lidClosed || _displayOff, _displayOff ? "display off" : "display on");
                    }
                }

                base.WndProc(ref m);
            }
        }
    }
}
