using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using trayapp.Structs;
using TrayApp;

namespace trayapp
{
    /// <summary>
    /// Resolves the process behind a window handle into its exe name, friendly
    /// description and full path.
    ///
    /// Only the path needs a P/Invoke: the managed equivalent (Process.MainModule)
    /// enumerates the target's modules and throws Win32Exception for cross-bitness /
    /// protected processes, so we use the Win32-recommended QueryFullProcessImageName
    /// instead. The name and description come from fully-managed APIs.
    /// </summary>
    internal static class ApplicationResolver
    {
        private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

        public static Application Resolve(IntPtr hwnd)
        {
            try
            {
                // UWP apps report as ApplicationFrameHost.exe unless we look inside
                // for their real hosted window (see ApplicationFrameHostResolver).
                hwnd = ApplicationFrameHostResolver.ResolveRealWindow(hwnd);

                GetWindowThreadProcessId(hwnd, out uint pid);

                // ProcessName reads a system snapshot (no module access) so it is
                // reliable and never throws Win32Exception.
                string exeName = "";
                try
                {
                    using (var proc = Process.GetProcessById((int)pid))
                        exeName = proc.ProcessName;
                }
                catch { }

                string path = GetImagePath(pid);

                // Read the description from the file on disk, not from process memory.
                string friendlyName = "";
                if (!string.IsNullOrEmpty(path))
                {
                    try { friendlyName = FileVersionInfo.GetVersionInfo(path).FileDescription ?? ""; }
                    catch { }
                }

                return new Application
                {
                    exeName = exeName,
                    fileDescription = friendlyName,
                    path = path
                };
            }
            catch (Exception ex)
            {
                Logger.Log($"ApplicationResolver: failed for hwnd={hwnd} - {ex.GetType().Name}: {ex.Message}");
                return new Application { exeName = "unknown" };
            }
        }

        private static string GetImagePath(uint pid)
        {
            IntPtr handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (handle == IntPtr.Zero)
                return "";

            try
            {
                var sb = new StringBuilder(1024);
                uint size = (uint)sb.Capacity;
                return QueryFullProcessImageName(handle, 0, sb, ref size) ? sb.ToString() : "";
            }
            finally
            {
                CloseHandle(handle);
            }
        }

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool QueryFullProcessImageName(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref uint lpdwSize);
    }
}
