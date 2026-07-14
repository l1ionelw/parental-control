using System;
using System.Net.WebSockets;
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
        private static readonly Uri ServerUri = new Uri("ws://127.0.0.1:5002/ws");

        private static readonly TimeSpan ReconnectDelay = TimeSpan.FromSeconds(5);

        // A focus session shorter than this is not reported (the "1 second debounce").
        private static readonly long MinSessionMs = 1000;

        // System.Text.Json ignores public fields unless told otherwise. Our message
        // structs (e.g. WindowChangedMessage) expose fields, so without this every
        // payload would serialize to "{}".
        private static readonly JsonSerializerOptions JsonOptions =
            new JsonSerializerOptions { IncludeFields = true };

        private static ClientWebSocket _ws;
        private static readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);
        private static CancellationTokenSource _cts;

        // Pending message: latest window state saved when WS is disconnected, drained on connect
        private static WindowChangedMessage? _pendingMessage;
        private static readonly object _pendingLock = new object();

        // Current focus session: the app in the foreground now and when it gained focus.
        // When focus changes we close this session and report it (if it lasted long
        // enough), then open a new one for the app we switched to.
        private static Application _currentApp;
        private static long _currentStartMs;
        private static bool _hasCurrent;
        private static readonly object _sessionLock = new object();

        public static void Start()
        {
            Logger.Log("AppWebSocketClient starting");
            _cts = new CancellationTokenSource();

            // Seed the session with whatever is focused at startup so the first real
            // switch reports the app the user was already in.
            IntPtr initial = WindowChangedListener.GetCurrentForegroundWindow();
            if (initial != IntPtr.Zero)
            {
                lock (_sessionLock)
                {
                    _currentApp = ApplicationResolver.Resolve(initial);
                    _currentStartMs = NowUnixMs();
                    _hasCurrent = true;
                }
            }

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
                    // Keepalive pings keep an idle connection alive and surface a dead
                    // peer (so we don't need an artificial receive timeout below).
                    _ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);
                    Logger.Log($"WS: connecting to {ServerUri}...");
                    await _ws.ConnectAsync(ServerUri, token);
                    Logger.Log("WS: connected");

                    await SendHandshake(token);
                    DrainPending(token);
                    await ReceiveLoop(token);
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
                deviceId = DeviceInfo.GetDeviceId(),      // -> deviceUser.deviceID (hashed hardware id)
                machineName = Environment.MachineName,     // -> deviceUser.deviceName
                userName = Environment.UserName            // -> deviceUser.osUsername
            };
            await SendJson(handshake, token);
        }

        private static async Task ReceiveLoop(CancellationToken token)
        {
            var buffer = new byte[4096];
            while (_ws.State == WebSocketState.Open && !token.IsCancellationRequested)
            {
                // Block until the server sends something or the connection drops. There
                // is deliberately no idle timeout: the server never sends unsolicited
                // data, so a timeout here would tear down a perfectly healthy connection
                // (this was causing a reconnect roughly every 30s). A genuinely dead peer
                // makes ReceiveAsync throw, which bubbles up to ConnectLoop and reconnects.
                var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), token);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    Logger.Log("WS: server closed connection");
                    return;
                }
            }
        }

        private static void OnWindowChanged(IntPtr hwnd)
        {
            long now = NowUnixMs();
            Application switchedTo = ApplicationResolver.Resolve(hwnd);

            WindowChangedMessage? toSend = null;
            lock (_sessionLock)
            {
                // 1 second debounce for min session minutes 
                if (_hasCurrent && now - _currentStartMs >= MinSessionMs)
                {
                    toSend = new WindowChangedMessage
                    {
                        type = "window_changed",
                        startTime = _currentStartMs,
                        endTime = now,
                        previous = _currentApp
                    };
                }

                _currentApp = switchedTo;
                _currentStartMs = now;
                _hasCurrent = true;
            }

            if (toSend.HasValue)
                SendOrQueue(toSend.Value);
        }

        private static void SendOrQueue(WindowChangedMessage msg)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    if (!await TrySendJson(msg, _cts?.Token ?? CancellationToken.None))
                    {
                        // Socket not open – save as pending so it fires on next connect
                        lock (_pendingLock)
                            _pendingMessage = msg;
                    }
                }
                catch (Exception ex)
                {
                    Logger.Log($"WS: failed to send window_changed - {ex.Message}");
                }
            });
        }

        private static long NowUnixMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        /// <summary>Try to send; return false if the socket isn't open or the send fails.
        /// Never throws – the caller can safely treat false as "save for later".</summary>
        private static async Task<bool> TrySendJson<T>(T payload, CancellationToken token)
        {
            // Snapshot the socket: the reconnect loop may dispose _ws / set it null
            // concurrently, so we must not re-read the field after the state check.
            var ws = _ws;
            if (ws == null || ws.State != WebSocketState.Open)
                return false;

            var json = JsonSerializer.Serialize(payload, JsonOptions);
            var bytes = Encoding.UTF8.GetBytes(json);

            await _sendLock.WaitAsync(token);
            try
            {
                await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, token);
                return true;
            }
            catch (Exception ex)
            {
                // Socket raced closed/disposed mid-send. Report false so the message
                // is queued as pending instead of being dropped.
                Logger.Log($"WS: send failed - {ex.GetType().Name}: {ex.Message}");
                return false;
            }
            finally
            {
                _sendLock.Release();
            }
        }

        private static async Task SendJson<T>(T payload, CancellationToken token)
        {
            if (_ws == null || _ws.State != WebSocketState.Open)
            {
                Logger.Log($"WS: dropped send, socket not open (state={_ws?.State.ToString() ?? "null"})");
                return;
            }

            var json = JsonSerializer.Serialize(payload, JsonOptions);
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

        private static void DrainPending(CancellationToken token)
        {
            WindowChangedMessage? pending;
            lock (_pendingLock)
            {
                pending = _pendingMessage;
                _pendingMessage = null;
            }

            if (pending.HasValue)
            {
                Logger.Log("WS: draining pending window_changed message");
                _ = TrySendJson(pending.Value, token);
            }
        }

    }
}