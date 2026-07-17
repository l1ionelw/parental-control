using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace trayapp
{
    /// <summary>
    /// UWP app windows (Store apps: Mail, Calculator, Settings, etc.) are hosted
    /// inside a window belonging to ApplicationFrameHost.exe, so resolving that
    /// window's PID directly reports the host container instead of the real app.
    /// This walks the container's child windows and returns the first one owned by
    /// a different process, mirroring the accepted answer's approach (matching by
    /// process name rather than window class, which turned out to be the part that
    /// actually works reliably here).
    ///
    /// The foreground-changed event can fire before the real app's child window is
    /// attached to the frame, so a single EnumChildWindows pass can come up empty
    /// right at the switch - retry a few times with a short delay before giving up.
    /// See: https://stackoverflow.com/questions/39702704
    /// </summary>
    internal static class ApplicationFrameHostResolver
    {
        private const string HostProcessName = "ApplicationFrameHost";
        private const int MaxAttempts = 6;
        private const int RetryDelayMs = 25;

        public static IntPtr ResolveRealWindow(IntPtr hwnd)
        {
            GetWindowThreadProcessId(hwnd, out uint pid);
            if (GetProcessNameSafe(pid) != HostProcessName)
                return hwnd;

            for (int attempt = 0; attempt < MaxAttempts; attempt++)
            {
                IntPtr realWindow = FindRealChildWindow(hwnd);
                if (realWindow != IntPtr.Zero)
                    return realWindow;

                Thread.Sleep(RetryDelayMs);
            }

            return hwnd;
        }

        private static IntPtr FindRealChildWindow(IntPtr hwnd)
        {
            IntPtr realWindow = IntPtr.Zero;

            EnumChildWindows(hwnd, (childHwnd, _) =>
            {
                GetWindowThreadProcessId(childHwnd, out uint childPid);
                if (GetProcessNameSafe(childPid) != HostProcessName)
                {
                    realWindow = childHwnd;
                }
                return true; // keep enumerating - last non-host child found wins
            }, IntPtr.Zero);

            return realWindow;
        }

        private static string GetProcessNameSafe(uint pid)
        {
            try
            {
                using (var proc = Process.GetProcessById((int)pid))
                    return proc.ProcessName;
            }
            catch
            {
                return "";
            }
        }

        private delegate bool EnumChildWindowsProc(IntPtr hwnd, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool EnumChildWindows(IntPtr hwndParent, EnumChildWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    }
}
