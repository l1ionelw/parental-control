using System;
using System.Windows.Forms;

namespace TrayApp
{
    internal static class Program
    {
        [STAThread]
        static void Main()
        {
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
    }
}
