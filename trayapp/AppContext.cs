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

            _container = new Container();
            _trayIcon = new NotifyIcon(_container)
            {
                Text = "TrayApp",
                Icon = SystemIcons.Application,
                Visible = true
            };
            var contextMenu = new ContextMenu(new[]
            {
                new MenuItem("E&xit", ExitApp)
            });

            _trayIcon.ContextMenu = contextMenu;

            Overlay.Start();
            WindowChangedListener.Start();
            ServerCommunicator.Start();
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
