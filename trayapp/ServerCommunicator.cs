using System;
using System.Net.Http;
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
        private static readonly TimeSpan ReconnectDelay = TimeSpan.FromSeconds(5);
        private static readonly long MinSessionMs = 1000;

        private static readonly JsonSerializerOptions JsonOptions =
            new JsonSerializerOptions { IncludeFields = true };

        private static ClientWebSocket _ws;
        private static readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);
        private static CancellationTokenSource _cts;

        private static WindowChangedMessage? _pendingMessage;
        private static readonly object _pendingLock = new object();

        private static Application _currentApp;
        private static long _currentStartMs;
        private static bool _hasCurrent;
        private static readonly object _sessionLock = new object();

        // Device registration info (populated after REST registration)
        private static string _deviceId;
        private static int _userId;
        private static string _username;

        public static void Start()
        {
            Logger.Log("AppWebSocketClient starting");
            _cts = new CancellationTokenSource();

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

        public static void Restart()
        {
            Logger.Log("WS: Restarting connection...");
            Stop();
            // Small delay to let the old connection clean up
            Task.Run(async () =>
            {
                await Task.Delay(500);
                Start();
            });
        }

        private static async Task ConnectLoop(CancellationToken token)
        {
            // Get server URL from config
            string serverUrl = ConfigManager.CurrentConfig.ServerUrl;
            if (string.IsNullOrEmpty(serverUrl))
            {
                Logger.Log("WS: No server URL configured, waiting for config...");
                return;
            }

            // Load persisted deviceId and userId from config
            if (!string.IsNullOrEmpty(ConfigManager.CurrentConfig.DeviceId) && ConfigManager.CurrentConfig.UserId > 0)
            {
                _deviceId = ConfigManager.CurrentConfig.DeviceId;
                _userId = ConfigManager.CurrentConfig.UserId;
                _username = ConfigManager.CurrentConfig.Username;
                Logger.Log($"WS: Loaded persisted config: DeviceId={_deviceId}, UserId={_userId}");
            }

            // Ensure device is registered (will skip if already have valid IDs)
            if (!await EnsureDeviceRegistered(serverUrl, token))
            {
                Logger.Log("WS: Device registration failed, will retry on reconnect");
            }

            while (!token.IsCancellationRequested)
            {
                try
                {
                    _ws = new ClientWebSocket();
                    _ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);

                    // Flask always serves plain HTTP/WS on port 5002 (or user-explicit port)
                    var httpUri = new Uri(serverUrl);
                    int port = httpUri.IsDefaultPort ? 5002 : httpUri.Port;
                    var wsUri = new UriBuilder("ws", httpUri.Host, port, "ws").Uri;
                    
                    Logger.Log($"WS: connecting to {wsUri}...");
                    await _ws.ConnectAsync(wsUri, token);
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

        private static async Task<bool> EnsureDeviceRegistered(string serverUrl, CancellationToken token)
        {
            // If we already have deviceId and userId from previous registration, use them
            if (!string.IsNullOrEmpty(_deviceId) && _userId > 0)
                return true;

            // DeviceId comes from hardware hash
            _deviceId = DeviceInfo.GetDeviceId();
            string deviceName = Environment.MachineName;
            string osUsername = Environment.UserName;

try
            {
                using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) })
                {
                    var svrUri = new Uri(serverUrl);
                    int svrPort = svrUri.IsDefaultPort ? 5002 : svrUri.Port;
                    var registerUrl = new UriBuilder("http", svrUri.Host, svrPort, "api/devices/register").Uri;
                    var payload = new
                    {
                        deviceId = _deviceId,
                        deviceName = deviceName,
                        osUsername = osUsername
                    };
                    var json = JsonSerializer.Serialize(payload);
                    var content = new StringContent(json, Encoding.UTF8, "application/json");

                    Logger.Log($"WS: Registering device with {registerUrl}...");
                    var response = await http.PostAsync(registerUrl, content, token);
                    var responseJson = await response.Content.ReadAsStringAsync();

                    if (!response.IsSuccessStatusCode)
                    {
                        Logger.Log($"WS: Device registration failed: {response.StatusCode} - {responseJson}");
                        return false;
                    }

                    var result = JsonSerializer.Deserialize<DeviceRegisterResponse>(responseJson);
                    if (result == null || result.userId <= 0)
                    {
                        Logger.Log("WS: Device registration returned invalid response");
                        return false;
                    }

                    _userId = result.userId;
                    _username = result.username;
                    _deviceId = result.deviceId; // in case server normalized it

                    // Save to config for persistence
                    ConfigManager.UpdateConfig(_deviceId, _userId, "", _username);

                    Logger.Log($"WS: Device registered successfully: deviceId={_deviceId}, userId={_userId}, username={_username}");
                    return true;
                }
            }
            catch (Exception ex)
            {
                Logger.Log($"WS: Device registration error - {ex.Message}");
                return false;
            }
        }

        private static async Task SendHandshake(CancellationToken token)
        {
            if (_userId <= 0 || string.IsNullOrEmpty(_deviceId))
            {
                Logger.Log("WS: Cannot send handshake - missing deviceId or userId");
                return;
            }

            var handshake = new
            {
                type = "handshake",
                deviceId = _deviceId,
                userId = _userId,
                username = _username
            };
            await SendJson(handshake, token);
        }

        private static async Task ReceiveLoop(CancellationToken token)
        {
            var buffer = new byte[4096];
            while (_ws.State == WebSocketState.Open && !token.IsCancellationRequested)
            {
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

        private static async Task<bool> TrySendJson<T>(T payload, CancellationToken token)
        {
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

        private class DeviceRegisterResponse
        {
            public int userId { get; set; }
            public string username { get; set; }
            public string deviceId { get; set; }
            public string deviceName { get; set; }
        }
    }
}