using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using TrayApp;

namespace trayapp
{
    public partial class Overlay : Form
    {
        // Kept public static so the GC never collects this while the window lives
        public static Overlay Instance;

        private const int MarginRight = 24;
        private const int MarginBottom = 24;
        private const int PaddingX = 10;
        private const int PaddingY = 6;
        private const int MaxChars = 25;

        public static void Start()
        {
            if (Instance != null)
            {
                Logger.Log("Overlay: Start() called but already running");
                return;
            }

            Instance = new Overlay();
            Instance.Show();
            Logger.Log("Overlay: WinForms overlay window created and shown");

            WindowChangedListener.RegisterCallback(OnForegroundWindowChanged);
            IntPtr initialHwnd = WindowChangedListener.GetCurrentForegroundWindow();
            if (initialHwnd != IntPtr.Zero)
                SetText(GetAppName(initialHwnd));
            Logger.Log("Overlay: Start() complete, callback registered");
        }

        private static void OnForegroundWindowChanged(IntPtr hwnd, long seq)
        {
            SetText(GetAppName(hwnd));
        }

        private static string GetAppName(IntPtr hwnd)
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

        public static void SetText(string text)
        {
            if (Instance == null)
            {
                Logger.Log("Overlay: SetText called but Instance is null, window not created");
                return;
            }

            if (text.Length > MaxChars)
                text = text.Substring(0, MaxChars) + "...";

            if (Instance.InvokeRequired)
            {
                Instance.Invoke(new Action(() => Instance.ApplyText(text)));
            }
            else
            {
                Instance.ApplyText(text);
            }
        }

        private string _text = "";

        public Overlay()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = Color.Black;
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 10f);

            // Position bottom-right BEFORE Show() so it never flashes at the default top-left/top-right spot
            Size = new Size(200, 40);
            Rectangle screen = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(screen.Right - MarginRight - Width, screen.Bottom - MarginBottom - Height);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                const int WS_EX_TOOLWINDOW = 0x00000080;
                const int WS_EX_NOACTIVATE = 0x08000000;
                const int WS_EX_TOPMOST = 0x00000008;

                CreateParams cp = base.CreateParams;
                cp.ExStyle |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST;
                return cp;
            }
        }

        protected override bool ShowWithoutActivation => true;

        public void ApplyText(string text)
        {
            _text = text;

            using (Graphics g = CreateGraphics())
            {
                SizeF measured = g.MeasureString(_text, Font);
                int width = (int)measured.Width + PaddingX * 2;
                int height = (int)measured.Height + PaddingY * 2;

                Rectangle screen = Screen.PrimaryScreen.WorkingArea;
                int x = screen.Right - MarginRight - width;
                int y = screen.Bottom - MarginBottom - height;

                Bounds = new Rectangle(x, y, width, height);
            }

            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (Brush brush = new SolidBrush(ForeColor))
            {
                e.Graphics.DrawString(_text, Font, brush, PaddingX, PaddingY);
            }
        }
    }
}