using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using trayapp.Structs;
using TrayApp;
namespace trayapp
{
    public static class WindowChangedListener
    {
        // Win32 constants
        private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
        private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
        // Delegate signature required by SetWinEventHook
        public delegate void WinEventDelegate(
            IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
            int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);
        // Public static so the GC never reclaims them while the hook is live
        public static WinEventDelegate WinEventProc;
        public static IntPtr HookHandle;
        // Registered callbacks, dispatched off the hook thread (see OnForegroundChanged)
        // in the order they were registered, but concurrently with each other.
        public static List<Action<IntPtr, long>> Callbacks = new List<Action<IntPtr, long>>();
        // Monotonically increasing per-event sequence number. WINEVENT_OUTOFCONTEXT
        // delivery relies on this thread pumping messages promptly - resolving the
        // real app behind a window (ApplicationFrameHostResolver) can block for up
        // to ~150ms, which during an alt-tab burst can cause the OS to drop events
        // for this listener. Handing resolution off to a background task keeps the
        // hook thread free; the sequence number lets subscribers that care about
        // ordering (see PreviousAppUsedTracker) discard a resolve that finishes
        // after a newer one already landed.
        private static long _sequenceCounter;
        public static long CurrentSequence => Interlocked.Read(ref _sequenceCounter);
        // Debounced settle-check: virtual-desktop switches and alt-tab bursts can
        // still occasionally drop an EVENT_SYSTEM_FOREGROUND event even with
        // dispatch off the hook thread. RecheckDelayMs after the *last* dispatched
        // switch, take one fresh GetForegroundWindow() read and correct if it
        // doesn't match what we last dispatched. The timer is reset on every
        // dispatch, so it only ever fires once things have settled, and quick
        // switches within the window never trigger a recheck at all.
        private const int RecheckDelayMs = 500;
        private static Timer _recheckTimer;
        private static readonly object _dispatchLock = new object();
        private static IntPtr _lastDispatchedHwnd = IntPtr.Zero;
        [DllImport("user32.dll")]
        private static extern IntPtr SetWinEventHook(
            uint eventMin, uint eventMax, IntPtr hmodWinEventProc,
            WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);
        [DllImport("user32.dll")]
        private static extern bool UnhookWinEvent(IntPtr hWinEventHook);
        public static void Start()
        {
            Logger.Log("Window event listener being created...");
            if (HookHandle != IntPtr.Zero)
            {
                Logger.Log("Window event listener already exists, doing nothing");
                return;
            }
            WinEventProc = OnForegroundChanged;
            HookHandle = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
                IntPtr.Zero, WinEventProc, 0, 0, WINEVENT_OUTOFCONTEXT);
            if (HookHandle == IntPtr.Zero)
            {
                Logger.Log("Window event listener: SetWinEventHook failed");
                throw new InvalidOperationException("SetWinEventHook failed.");
            }

            _recheckTimer = new Timer(OnRecheckTimerFired, null, Timeout.Infinite, Timeout.Infinite);

            Logger.Log("Window event listener created successfully");
        }
        public static void Stop()
        {
            if (HookHandle != IntPtr.Zero)
            {
                UnhookWinEvent(HookHandle);
                HookHandle = IntPtr.Zero;
            }
            _recheckTimer?.Dispose();
            _recheckTimer = null;
        }
        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        public static IntPtr GetCurrentForegroundWindow()
        {
            return GetForegroundWindow();
        }

        // Same resolution a window_changed event's app details go through (AFH
        // unwrapping + exeName/fileDescription/path), but on demand - for callers
        // that need "what's focused right now" without waiting for a switch event.
        internal static Application GetCurrentApplication()
        {
            return ApplicationResolver.Resolve(GetForegroundWindow());
        }
        public static void RegisterCallback(Action<IntPtr, long> callback)
        {
            Logger.Log("window changed listener: new callback added");
            lock (Callbacks)
            {
                Callbacks.Add(callback);
            }
        }
        private static void OnForegroundChanged(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
        {
            if (eventType != EVENT_SYSTEM_FOREGROUND || hwnd == IntPtr.Zero)
                return;

            Dispatch(hwnd);

            // Reset the settle-check timer on every switch, so it only fires once
            // RecheckDelayMs has passed since the *last* one.
            _recheckTimer?.Change(RecheckDelayMs, Timeout.Infinite);
        }

        private static void OnRecheckTimerFired(object state)
        {
            IntPtr current = GetForegroundWindow();
            if (current == IntPtr.Zero)
                return;

            lock (_dispatchLock)
            {
                if (current == _lastDispatchedHwnd)
                    return; // already tracking this window - nothing drifted
            }

            Logger.Log($"Window changed listener: settle-check found foreground drifted to hwnd={current}, correcting");
            Dispatch(current);
        }

        private static void Dispatch(IntPtr hwnd)
        {
            long seq = Interlocked.Increment(ref _sequenceCounter);

            lock (_dispatchLock)
            {
                _lastDispatchedHwnd = hwnd;
            }

            // Snapshot the callback list so iteration is safe even if a callback mutates it
            Action<IntPtr, long>[] snapshot;
            lock (Callbacks)
            {
                snapshot = Callbacks.ToArray();
            }

            // Callback work (resolving the real app behind a window, in particular)
            // can block for a while - do it off this thread so the hook keeps
            // pumping messages and doesn't miss the next event in a fast burst
            // (e.g. alt-tabbing through several windows).
            Task.Run(() =>
            {
                string exeName = GetProcessName(hwnd);
                Logger.Log($"Window changed! app={exeName} hwnd={hwnd} seq={seq}");
                foreach (var cb in snapshot)
                {
                    try { cb(hwnd, seq); } catch { }
                }
            });
        }
        private static string GetProcessName(IntPtr hwnd)
        {
            try
            {
                GetWindowThreadProcessId(hwnd, out uint pid);
                using (var proc = System.Diagnostics.Process.GetProcessById((int)pid))
                {
                    return proc.ProcessName;
                }
            }
            catch
            {
                return "unknown";
            }
        }
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    }
}