using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace TrayApp
{
    internal static class Program
    {
        [STAThread]
        static void Main()
        {
            // Without this, the process is DPI-unaware and Windows DPI-virtualizes
            // it: GDI calls (Screen.Bounds, CopyFromScreen in VideoShare) only see
            // the scaled-down virtualized view instead of real physical pixels, so
            // screen capture only shows part of the screen on any scaled display.
            SetDpiAwareness();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // Check for existing configuration before starting the app
            bool hasConfig = ConfigManager.CheckForConfig();
            Logger.Log($"Program: Config check completed, hasConfig={hasConfig}");

            if (!hasConfig)
            {
                using (var dialog = new ServerUrlDialog())
                {
                    var result = dialog.ShowDialog();
                    if (result != DialogResult.OK || string.IsNullOrEmpty(dialog.ServerUrl))
                    {
                        Logger.Log("Program: User cancelled server URL dialog, exiting");
                        return;
                    }
                    ConfigManager.SaveConfig(dialog.ServerUrl);
                    Logger.Log("Program: Server URL saved: " + dialog.ServerUrl);
                }
            }

            Application.Run(new TrayOnlyApplication());
        }

        private static void SetDpiAwareness()
        {
            try
            {
                // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (Windows 10 1703+)
                SetProcessDpiAwarenessContext(new IntPtr(-4));
            }
            catch
            {
                // Older Windows without the per-monitor-v2 API - system DPI aware
                // is still far better than DPI-unaware.
                try { SetProcessDPIAware(); } catch { }
            }
        }

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();
    }
}
