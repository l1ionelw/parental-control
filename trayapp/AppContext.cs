using System;
using System.ComponentModel;
using System.Drawing;
using System.Windows.Forms;
using trayapp;

namespace TrayApp
{
    internal class TrayOnlyApplication : ApplicationContext
    {
        private NotifyIcon _trayIcon;
        private IContainer _container;

        public TrayOnlyApplication()
        {
            Logger.Log("TRAY APP START");
            InitializeTrayAndServices();
        }

        private void InitializeTrayAndServices()
        {
            _container = new Container();
            _trayIcon = new NotifyIcon(_container)
            {
                Text = "Parental Controls",
                Icon = SystemIcons.Application,
                Visible = true
            };
            var contextMenu = new ContextMenu(new[]
            {
                new MenuItem("Configure Server", ShowServerConfig),
                new MenuItem("-"),
                new MenuItem("E&xit", ExitApp)
            });

            _trayIcon.ContextMenu = contextMenu;

            Overlay.Start();
            WindowChangedListener.Start();
            ServerCommunicator.Start();
        }

        private void ShowServerConfig(object sender, EventArgs e)
        {
            using (var dialog = new ServerUrlDialog())
            {
                // Pre-fill with current server URL if available
                dialog.ServerUrl = ConfigManager.CurrentConfig?.ServerUrl ?? "";
                Logger.Log($"ShowServerConfig: current ServerUrl={dialog.ServerUrl}");
                var result = dialog.ShowDialog();
                Logger.Log($"ShowServerConfig: dialog result={result}, ServerUrl={dialog.ServerUrl}");
                if (result == DialogResult.OK && !string.IsNullOrEmpty(dialog.ServerUrl))
                {
                    Logger.Log("ConfigManager: Server URL updated: " + dialog.ServerUrl);
                    ConfigManager.SaveConfig(dialog.ServerUrl);
                    // Restart the WebSocket connection with new URL
                    ServerCommunicator.Restart();
                }
            }
        }

        private void ExitApp(object sender, EventArgs e)
        {
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
            _container.Dispose();
            Application.Exit();
        }
    }
}
