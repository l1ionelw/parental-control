using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using TrayApp;

namespace trayapp
{
    // Small loopback-only HTTP server the chrome extension posts tab activity to,
    // replacing the extension's old direct websocket connection to the remote
    // server. No auth - same trust boundary as the rest of this desktop app
    // (single-tenant machine, loopback only).
    internal static class LocalExtensionServer
    {
        private const int Port = 58231;

        private static HttpListener _listener;

        public static void Start()
        {
            if (_listener != null)
                return;

            _listener = new HttpListener();
            _listener.Prefixes.Add($"http://127.0.0.1:{Port}/");

            try
            {
                _listener.Start();
            }
            catch (Exception ex)
            {
                Logger.Log($"LocalExtensionServer: failed to start - {ex.Message}");
                _listener = null;
                return;
            }

            Logger.Log($"LocalExtensionServer: listening on http://127.0.0.1:{Port}/");
            _ = Task.Run(ListenLoop);
        }

        public static void Stop()
        {
            try { _listener?.Stop(); } catch { }
            _listener = null;
        }

        private static async Task ListenLoop()
        {
            var listener = _listener;
            while (listener != null && listener.IsListening)
            {
                HttpListenerContext ctx;
                try
                {
                    ctx = await listener.GetContextAsync();
                }
                catch (Exception)
                {
                    break; // listener stopped/disposed
                }

                _ = Task.Run(() => HandleRequest(ctx));
            }
        }

        private static void HandleRequest(HttpListenerContext ctx)
        {
            try
            {
                string path = ctx.Request.Url.AbsolutePath;
                if (ctx.Request.HttpMethod == "POST" && path == "/tab-switch")
                {
                    var body = ReadBody(ctx.Request);
                    if (TryParseTabPayload(body, out string url, out string title, out long timestamp))
                        TabActivityStore.RecordTabSwitch(url, title, timestamp);
                }
                else if (ctx.Request.HttpMethod == "POST" && path == "/tab-heartbeat")
                {
                    var body = ReadBody(ctx.Request);
                    if (TryParseTabPayload(body, out string url, out string title, out long timestamp))
                        TabActivityStore.RecordHeartbeat(url, title, timestamp);
                }
                else
                {
                    ctx.Response.StatusCode = 404;
                }
            }
            catch (Exception ex)
            {
                Logger.Log($"LocalExtensionServer: request failed - {ex.Message}");
                try { ctx.Response.StatusCode = 400; } catch { }
            }
            finally
            {
                try { ctx.Response.Close(); } catch { }
            }
        }

        private static string ReadBody(HttpListenerRequest request)
        {
            using (var reader = new StreamReader(request.InputStream, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        private static bool TryParseTabPayload(string json, out string url, out string title, out long timestamp)
        {
            url = null;
            title = null;
            timestamp = 0;

            try
            {
                using (var doc = JsonDocument.Parse(json))
                {
                    var root = doc.RootElement;
                    url = root.TryGetProperty("url", out var u) ? u.GetString() : null;
                    title = root.TryGetProperty("title", out var t) ? t.GetString() : null;
                    timestamp = root.TryGetProperty("timestamp", out var ts) && ts.ValueKind == JsonValueKind.Number
                        ? ts.GetInt64()
                        : 0;
                }
            }
            catch (Exception ex)
            {
                Logger.Log($"LocalExtensionServer: failed to parse request body - {ex.Message}");
                return false;
            }

            return !string.IsNullOrEmpty(url) && timestamp > 0;
        }
    }
}
