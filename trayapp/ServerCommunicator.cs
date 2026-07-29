using System;
using System.Collections.Generic;
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

        private static readonly JsonSerializerOptions JsonOptions =
            new JsonSerializerOptions { IncludeFields = true };

        private static ClientWebSocket _ws;
        private static readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);
        private static CancellationTokenSource _cts;

        // True once the handshake has been sent on a live socket; other classes
        // (DowntimeEnforcer, ScreenTimeEnforcer) poll this before requesting config.
        private static volatile bool _isConnected;
        public static bool IsConnected => _isConnected;

        // Incoming message dispatch, keyed by the "type" field (see DispatchMessage).
        private static readonly object _handlersLock = new object();
        private static readonly Dictionary<string, Action<JsonElement>> _messageHandlers =
            new Dictionary<string, Action<JsonElement>>();

        private static WindowChangedMessage? _pendingAppEvent;
        private static WebsiteChangedMessage? _pendingWebsiteChanged;
        private static WebsiteHeartbeatMessage? _pendingWebsiteHeartbeat;
        private static readonly object _pendingLock = new object();

        // Device registration info (populated after REST registration)
        private static string _deviceId;
        private static int _userId;
        private static string _username;

        public static void Start()
        {
            Logger.Log("AppWebSocketClient starting");
            _cts = new CancellationTokenSource();

            RegisterMessageHandler("start_stream", _ => VideoShare.StartCapture());
            RegisterMessageHandler("stop_stream", _ => VideoShare.StopCapture());
            VideoShare.SetFrameCallback(SendStreamFrame);

            RegisterMessageHandler("manual_block", OnManualBlockMessage);

            _ = Task.Run(() => ConnectLoop(_cts.Token));
        }

        public static void Stop()
        {
            _isConnected = false;
            _cts?.Cancel();
            try { _ws?.Abort(); } catch { }
        }

        // The server relays this to the tray app when either an admin starts
        // watching it or the current viewer count drops to zero.
        private static void SendStreamFrame(string base64)
        {
            var cts = _cts;
            // Best-effort, no retry/queueing (unlike window_changed): a dropped
            // frame doesn't matter, the next one is a fraction of a second away.
            _ = TrySendJson(new { type = "stream_frame", frame = base64 }, cts?.Token ?? CancellationToken.None);
        }

        // Lets other classes react to server-initiated messages without ServerCommunicator
        // needing to know anything about them (see DowntimeEnforcer/ScreenTimeEnforcer).
        public static void RegisterMessageHandler(string type, Action<JsonElement> handler)
        {
            lock (_handlersLock)
            {
                _messageHandlers[type] = handler;
            }
        }

        public static Task<bool> SendRequest(object payload, CancellationToken token)
        {
            return TrySendJson(payload, token);
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

            while (!token.IsCancellationRequested)
            {
                // Ensure we have valid credentials before connecting
                if (_userId <= 0 || string.IsNullOrEmpty(_deviceId))
                {
                    if (!await EnsureDeviceRegistered(serverUrl, token))
                    {
                        Logger.Log("WS: Device registration failed, retrying in 5s");
                        try { await Task.Delay(ReconnectDelay, token); }
                        catch (TaskCanceledException) { break; }
                        continue;
                    }
                }

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
                    _isConnected = false;
                    DowntimeEnforcer.Deactivate();
                    ScreenTimeEnforcer.Deactivate();
                    AlwaysAllowedApps.Deactivate();
                    TabActivityStore.Deactivate();
                    VideoShare.StopCapture();
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
            _isConnected = true;

            // Hardcoded for now - only two listeners exist. If more classes need to
            // react to (re)connection, replace this with a small event/callback list.
            DowntimeEnforcer.Activate();
            ScreenTimeEnforcer.Activate();
            _ = DowntimeEnforcer.ManualReload(token);
            _ = ScreenTimeEnforcer.ManualReload(token);
            _ = TabActivityStore.ManualReload(token);
            AlwaysAllowedApps.ManualReload();

            // Each guards itself to run only once per process lifetime (see their
            // own SeedTodayHistory) - called on every (re)connect same as the
            // syncs above since it's cheap to no-op after the first time, and
            // simpler than tracking "have we ever connected" here separately.
            _ = AppActivityStore.SeedTodayHistory(token);
            _ = TabActivityStore.SeedTodayHistory(token);

            // Manual block is server-authoritative and not deactivated on
            // disconnect (see ManualBlockEnforcer) - just re-synced on every
            // (re)connect, same as the config syncs above.
            _ = SendRequest(new { type = "get_manual_block" }, token);
        }

        private static void OnManualBlockMessage(JsonElement root)
        {
            bool blocked = root.TryGetProperty("blocked", out var blockedProp) && blockedProp.GetBoolean();
            if (!blocked)
            {
                ManualBlockEnforcer.Stop();
                return;
            }

            long? endTime = null;
            if (root.TryGetProperty("endTime", out var endTimeProp) && endTimeProp.ValueKind == JsonValueKind.Number)
                endTime = endTimeProp.GetInt64();

            ManualBlockEnforcer.Start(endTime);
        }

        private static async Task ReceiveLoop(CancellationToken token)
        {
            var buffer = new byte[16384];
            while (_ws.State == WebSocketState.Open && !token.IsCancellationRequested)
            {
                var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), token);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    Logger.Log("WS: server closed connection");
                    return;
                }

                if (result.MessageType == WebSocketMessageType.Text && result.Count > 0)
                {
                    string text = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    DispatchMessage(text);
                }
            }
        }

        private static void DispatchMessage(string json)
        {
            try
            {
                using (var doc = JsonDocument.Parse(json))
                {
                    if (!doc.RootElement.TryGetProperty("type", out var typeProp))
                        return;

                    string type = typeProp.GetString();
                    Action<JsonElement> handler;
                    lock (_handlersLock)
                    {
                        _messageHandlers.TryGetValue(type ?? "", out handler);
                    }

                    // Clone so the element outlives this JsonDocument (handlers may
                    // process it asynchronously).
                    handler?.Invoke(doc.RootElement.Clone());
                }
            }
            catch (Exception ex)
            {
                Logger.Log($"WS: failed to parse incoming message - {ex.Message}");
            }
        }

        // Called by PreviousAppUsedTracker on every window switch, regardless of
        // duration - the server needs 'current' to keep its own "what's focused
        // right now" cache live in real time (see trayapp_ws.open_app_sessions).
        // Whether 'previous' gets persisted into history/usage is a call the
        // server makes based on duration, not something decided here.
        public static void ReportAppSession(AppSwitchedEvent evt)
        {
            SendOrQueue(new WindowChangedMessage
            {
                type = "window_changed",
                startTime = evt.StartTime,
                endTime = evt.EndTime,
                previous = evt.Previous,
                current = evt.Current
            });
        }

        // Called by TabActivityStore whenever a tab switch (or the 3-minute
        // heartbeat-timeout watchdog) closes out the previously-open tab and opens
        // a new one - relays it to the server in the same shape the chrome
        // extension used to send directly (see browser_ws.py.handle_website_changed).
        public static void ReportWebsiteSession(string url, string title, long switchTime)
        {
            SendOrQueue(new WebsiteChangedMessage
            {
                type = "website_changed",
                after = new WebsiteTab { url = url, title = title },
                switchTime = switchTime
            });
        }

        // Called by TabActivityStore on every tab_heartbeat that matches the
        // currently tracked tab - keeps the remote server's open session's endTime
        // moving forward (see browser_ws.py.handle_website_heartbeat).
        public static void ReportWebsiteHeartbeat(string url, string title, long timestamp)
        {
            SendOrQueue(new WebsiteHeartbeatMessage
            {
                type = "website_heartbeat",
                tab = new WebsiteTab { url = url, title = title },
                timestamp = timestamp
            });
        }

        private static void SendOrQueue(WindowChangedMessage msg)
        {
            SendOrQueue(msg, "window_changed", m => { lock (_pendingLock) _pendingAppEvent = m; });
        }

        private static void SendOrQueue(WebsiteChangedMessage msg)
        {
            SendOrQueue(msg, "website_changed", m => { lock (_pendingLock) _pendingWebsiteChanged = m; });
        }

        private static void SendOrQueue(WebsiteHeartbeatMessage msg)
        {
            SendOrQueue(msg, "website_heartbeat", m => { lock (_pendingLock) _pendingWebsiteHeartbeat = m; });
        }

        // Shared send-now-or-remember-for-reconnect path for every message type
        // above - each type keeps its own single pending slot (see DrainPending),
        // same one-slot-per-type behavior the original window_changed-only version
        // had (a burst of failures while disconnected just keeps the latest).
        private static void SendOrQueue<T>(T msg, string typeLabel, Action<T> setPending)
        {
            var cts = _cts;
            _ = Task.Run(async () =>
            {
                try
                {
                    if (!await TrySendJson(msg, cts?.Token ?? CancellationToken.None))
                        setPending(msg);
                }
                catch (Exception ex)
                {
                    Logger.Log($"WS: failed to send {typeLabel} - {ex.Message}");
                }
            });
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
            WindowChangedMessage? pendingAppEvent;
            WebsiteChangedMessage? pendingWebsiteChanged;
            WebsiteHeartbeatMessage? pendingWebsiteHeartbeat;
            lock (_pendingLock)
            {
                pendingAppEvent = _pendingAppEvent;
                pendingWebsiteChanged = _pendingWebsiteChanged;
                pendingWebsiteHeartbeat = _pendingWebsiteHeartbeat;
                _pendingAppEvent = null;
                _pendingWebsiteChanged = null;
                _pendingWebsiteHeartbeat = null;
            }

            if (pendingAppEvent.HasValue)
            {
                Logger.Log("WS: draining pending window_changed message");
                _ = TrySendJson(pendingAppEvent.Value, token);
            }
            if (pendingWebsiteChanged.HasValue)
            {
                Logger.Log("WS: draining pending website_changed message");
                _ = TrySendJson(pendingWebsiteChanged.Value, token);
            }
            if (pendingWebsiteHeartbeat.HasValue)
            {
                Logger.Log("WS: draining pending website_heartbeat message");
                _ = TrySendJson(pendingWebsiteHeartbeat.Value, token);
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