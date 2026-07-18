using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using TrayApp;

namespace trayapp
{
    /// <summary>
    /// Kills the process behind whatever window is currently focused - the actual
    /// enforcement action for DowntimeEnforcer, ScreenTimeEnforcer, and
    /// ManualBlockEnforcer, which otherwise only track state. Shows a message box
    /// after an actual termination (not on skips) explaining why.
    /// </summary>
    internal static class ProcessTerminationManager
    {
        public static void TerminateForegroundProcess(string blockedMessage)
        {
            IntPtr hwnd = WindowChangedListener.GetCurrentForegroundWindow();
            if (hwnd == IntPtr.Zero)
                return;

            // Same AFH unwrapping ApplicationResolver does, so a UWP app's real
            // process gets killed instead of the ApplicationFrameHost container.
            hwnd = ApplicationFrameHostResolver.ResolveRealWindow(hwnd);

            GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == 0)
                return;

            try
            {
                using (var proc = Process.GetProcessById((int)pid))
                {
                    string exeName = proc.ProcessName;

                    if (IsProtected(proc, exeName))
                        return;

                    if (AlwaysAllowedApps.IsAlwaysAllowed(exeName))
                        return;

                    Logger.Log($"ProcessTerminationManager: terminating {exeName} (pid={pid})");
                    proc.Kill();

                    ShowBlockedMessage(blockedMessage);
                }
            }
            catch (Exception ex)
            {
                Logger.Log($"ProcessTerminationManager: failed to terminate pid={pid} - {ex.Message}");
            }
        }

        private static void ShowBlockedMessage(string message)
        {
            if (string.IsNullOrEmpty(message))
                return;

            try
            {
                MessageBox.Show(message, "Parental Controls", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            catch (Exception ex)
            {
                Logger.Log($"ProcessTerminationManager: failed to show blocked message - {ex.Message}");
            }
        }

        // Never kill ourselves (so our own message boxes always get to show) or
        // core shell/system processes, even if somehow focused. Checked both by
        // PID (authoritative) and by name (belt-and-suspenders, per instructions).
        private static bool IsProtected(Process proc, string exeName)
        {
            if (proc.Id == Process.GetCurrentProcess().Id)
                return true;

            switch (exeName.ToLowerInvariant())
            {
                case "trayapp":
                case "explorer":
                case "dwm":
                case "winlogon":
                case "csrss":
                case "wininit":
                case "services":
                case "lsass":
                case "svchost":
                    return true;
                default:
                    return false;
            }
        }

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    }
}
