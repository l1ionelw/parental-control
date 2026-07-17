using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using TrayApp;

namespace trayapp
{
    /// <summary>
    /// Captures the primary screen at a fixed low framerate and JPEG-encodes each
    /// frame, handing it to whatever callback ServerCommunicator registers.
    ///
    /// Uses GDI (Graphics.CopyFromScreen) rather than the Windows.Graphics.Capture
    /// API: true WGC needs hand-rolled WinRT/D3D11 COM interop (IGraphicsCaptureItemInterop,
    /// CreateDirect3D11DeviceFromDXGIDevice, texture mapping) that couldn't be
    /// visually verified in the environment this was built in. GDI is dependency-free
    /// and reliable; swapping in WGC later only means replacing CaptureFrame() below -
    /// the encode/callback pipeline doesn't change.
    /// </summary>
    internal static class VideoShare
    {
        private const int TargetFps = 15;
        private const long JpegQuality = 50L; // 0-100

        private static readonly object _lock = new object();
        private static CancellationTokenSource _cts;
        private static Action<string> _onFrameBase64;

        // Set once at startup by ServerCommunicator - called with each captured
        // frame's base64 JPEG data.
        public static void SetFrameCallback(Action<string> onFrameBase64)
        {
            _onFrameBase64 = onFrameBase64;
        }

        public static void StartCapture()
        {
            lock (_lock)
            {
                if (_cts != null && !_cts.IsCancellationRequested)
                    return; // already capturing

                Logger.Log("VideoShare: starting capture");
                _cts = new CancellationTokenSource();
                _ = Task.Run(() => CaptureLoop(_cts.Token));
            }
        }

        public static void StopCapture()
        {
            CancellationTokenSource cts;
            lock (_lock)
            {
                cts = _cts;
                _cts = null;
            }

            if (cts != null)
            {
                Logger.Log("VideoShare: stopping capture");
                cts.Cancel();
            }
        }

        private static async Task CaptureLoop(CancellationToken token)
        {
            var frameInterval = TimeSpan.FromMilliseconds(1000.0 / TargetFps);

            while (!token.IsCancellationRequested)
            {
                try
                {
                    string base64 = CaptureFrameAsBase64Jpeg();
                    if (base64 != null)
                        _onFrameBase64?.Invoke(base64);
                }
                catch (Exception ex)
                {
                    Logger.Log($"VideoShare: capture failed - {ex.Message}");
                }

                try { await Task.Delay(frameInterval, token); }
                catch (TaskCanceledException) { break; }
            }
        }

        private static string CaptureFrameAsBase64Jpeg()
        {
            Rectangle bounds = Screen.PrimaryScreen.Bounds;

            using (var bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppRgb))
            {
                using (var g = Graphics.FromImage(bitmap))
                {
                    g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                    DrawCursor(g, bounds);
                }

                using (var ms = new MemoryStream())
                {
                    ImageCodecInfo encoder = GetJpegEncoder();
                    if (encoder == null)
                    {
                        bitmap.Save(ms, ImageFormat.Jpeg);
                    }
                    else
                    {
                        using (var encoderParams = new EncoderParameters(1))
                        {
                            encoderParams.Param[0] = new EncoderParameter(Encoder.Quality, JpegQuality);
                            bitmap.Save(ms, encoder, encoderParams);
                        }
                    }

                    return Convert.ToBase64String(ms.ToArray());
                }
            }
        }

        private static ImageCodecInfo GetJpegEncoder()
        {
            foreach (var codec in ImageCodecInfo.GetImageEncoders())
            {
                if (codec.FormatID == ImageFormat.Jpeg.Guid)
                    return codec;
            }
            return null;
        }

        // CopyFromScreen doesn't include the cursor - draw it in ourselves from
        // GetCursorInfo (current icon + screen position) and GetIconInfo (the
        // hotspot, so the pointer's tip lines up with the actual click point
        // rather than the icon's top-left corner).
        private static void DrawCursor(Graphics g, Rectangle bounds)
        {
            var cursorInfo = new CURSORINFO { cbSize = Marshal.SizeOf(typeof(CURSORINFO)) };
            if (!GetCursorInfo(out cursorInfo) || cursorInfo.hCursor == IntPtr.Zero)
                return;
            if ((cursorInfo.flags & CURSOR_SHOWING) == 0)
                return;

            int hotspotX = 0, hotspotY = 0;
            if (GetIconInfo(cursorInfo.hCursor, out ICONINFO iconInfo))
            {
                hotspotX = iconInfo.xHotspot;
                hotspotY = iconInfo.yHotspot;
                // GetIconInfo allocates these bitmaps for us - we only need the
                // hotspot, so free them immediately to avoid leaking GDI handles.
                if (iconInfo.hbmMask != IntPtr.Zero) DeleteObject(iconInfo.hbmMask);
                if (iconInfo.hbmColor != IntPtr.Zero) DeleteObject(iconInfo.hbmColor);
            }

            int x = cursorInfo.ptScreenPos.X - bounds.Left - hotspotX;
            int y = cursorInfo.ptScreenPos.Y - bounds.Top - hotspotY;

            IntPtr hdc = g.GetHdc();
            try
            {
                DrawIcon(hdc, x, y, cursorInfo.hCursor);
            }
            finally
            {
                g.ReleaseHdc(hdc);
            }
        }

        private const int CURSOR_SHOWING = 0x1;

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct CURSORINFO
        {
            public int cbSize;
            public int flags;
            public IntPtr hCursor;
            public POINT ptScreenPos;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct ICONINFO
        {
            public bool fIcon;
            public int xHotspot;
            public int yHotspot;
            public IntPtr hbmMask;
            public IntPtr hbmColor;
        }

        [DllImport("user32.dll")]
        private static extern bool GetCursorInfo(out CURSORINFO pci);

        [DllImport("user32.dll")]
        private static extern bool GetIconInfo(IntPtr hIcon, out ICONINFO piconinfo);

        [DllImport("user32.dll")]
        private static extern bool DrawIcon(IntPtr hDC, int x, int y, IntPtr hIcon);

        [DllImport("gdi32.dll")]
        private static extern bool DeleteObject(IntPtr hObject);
    }
}
