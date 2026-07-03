using System;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using trayapp.Structs;
using TrayApp;

namespace trayapp
{
    internal static class ServerCommunicator
    {
        // hardcoded server address
        private static readonly Uri ServerUri = new Uri("ws://127.0.0.1:5002/ws");

        private static readonly TimeSpan ReconnectDelay = TimeSpan.FromSeconds(5);
        private static readonly TimeSpan ReceiveTimeout = TimeSpan.FromSeconds(30);

        private static ClientWebSocket _ws;
        private static readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);
        private static CancellationTokenSource _cts;

        public static void Start()
        {
            Logger.Log("AppWebSocketClient starting");
            _cts = new CancellationTokenSource();
            WindowChangedListener.RegisterCallback(OnWindowChanged);
            _ = Task.Run(() => ConnectLoop(_cts.Token));
        }

        public static void Stop()
        {
            _cts?.Cancel();
            try { _ws?.Abort(); } catch { }
        }

        private static async Task ConnectLoop(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    _ws = new ClientWebSocket();
                    Logger.Log($"WS: connecting to {ServerUri}...");
                    await _ws.ConnectAsync(ServerUri, token);
                    Logger.Log("WS: connected");

                    await SendHandshake(token);
                    await ReceiveLoop(token); // blocks until closed / timed out / errored
                }
                catch (Exception ex)
                {
                    Logger.Log($"WS: error - {ex.Message}");
                }
                finally
                {
                    _ws?.Dispose();
                    _ws = null;
                }

                if (token.IsCancellationRequested)
                    break;

                Logger.Log($"WS: reconnecting in {ReconnectDelay.TotalSeconds}s");
                try { await Task.Delay(ReconnectDelay, token); }
                catch (TaskCanceledException) { break; }
            }
        }

        private static async Task SendHandshake(CancellationToken token)
        {
            var handshake = new
            {
                type = "handshake",
                machineName = Environment.MachineName,
                userName = Environment.UserName
            };
            await SendJson(handshake, token);
        }

        private static async Task ReceiveLoop(CancellationToken token)
        {
            var buffer = new byte[4096];
            while (_ws.State == WebSocketState.Open && !token.IsCancellationRequested)
            {
                using (var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(token))
                {
                    timeoutCts.CancelAfter(ReceiveTimeout);

                    WebSocketReceiveResult result;
                    try
                    {
                        result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), timeoutCts.Token);
                    }
                    catch (OperationCanceledException) when (!token.IsCancellationRequested)
                    {
                        Logger.Log("WS: receive timed out, reconnecting");
                        return; // falls back to ConnectLoop, which reconnects
                    }

                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        Logger.Log("WS: server closed connection");
                        return;
                    }
                    // inbound payloads (if any) currently ignored
                }
            }
        }

        private static void OnWindowChanged(IntPtr hwnd)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    var app = ResolveApplication(hwnd);
                    var msg = new WindowChangedMessage
                    {
                        type = "window_changed",
                        exeName = app.exeName,
                        friendlyName = app.fileDescription,
                        path = app.path
                    };
                    await SendJson(msg, _cts?.Token ?? CancellationToken.None);
                }
                catch (Exception ex)
                {
                    Logger.Log($"WS: failed to send window_changed - {ex.Message}");
                }
            });
        }

        private static async Task SendJson<T>(T payload, CancellationToken token)
        {
            if (_ws == null || _ws.State != WebSocketState.Open)
            {
                Logger.Log($"WS: dropped send, socket not open (state={_ws?.State.ToString() ?? "null"})");
                return;
            }

            var json = JsonSerializer.Serialize(payload);
            var bytes = Encoding.UTF8.GetBytes(json);

            await _sendLock.WaitAsync(token);
            try
            {
                await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, token);
            }
            finally
            {
                _sendLock.Release();
            }
        }

        private static Application ResolveApplication(IntPtr hwnd)
        {
            GetWindowThreadProcessId(hwnd, out uint pid);
            using (var proc = System.Diagnostics.Process.GetProcessById((int)pid))
            {
                string path = "";
                string fileDescription = "";
                try { path = proc.MainModule.FileName; } catch { }
                try { fileDescription = proc.MainModule.FileVersionInfo.FileDescription ?? ""; } catch { }

                return new Application
                {
                    exeName = proc.ProcessName,
                    fileDescription = fileDescription,
                    path = path
                };
            }
        }

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    }
}