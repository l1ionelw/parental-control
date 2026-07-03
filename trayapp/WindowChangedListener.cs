using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
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
        // Registered callbacks, invoked synchronously in order
        public static List<Action<IntPtr>> Callbacks = new List<Action<IntPtr>>();
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

            Logger.Log("Window event listener created successfully");
        }
        public static void Stop()
        {
            if (HookHandle != IntPtr.Zero)
            {
                UnhookWinEvent(HookHandle);
                HookHandle = IntPtr.Zero;
            }
        }
        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        public static IntPtr GetCurrentForegroundWindow()
        {
            return GetForegroundWindow();
        }
        public static void RegisterCallback(Action<IntPtr> callback)
        {
            Logger.Log("window changed listener: new callback added");
            Callbacks.Add(callback);
        }
        private static void OnForegroundChanged(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
        {
            if (eventType != EVENT_SYSTEM_FOREGROUND || hwnd == IntPtr.Zero)
                return;
            string exeName = GetProcessName(hwnd);
            Logger.Log($"Window changed! app={exeName} hwnd={hwnd}");
            foreach (var cb in Callbacks)
            {
                cb(hwnd);
            }
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