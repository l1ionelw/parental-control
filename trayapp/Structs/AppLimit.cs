namespace trayapp.Structs
{
    // Mirrors the server's /api/limits row merged with its Application (see
    // server.py _build_app_limits_payload) - allPaths is included because
    // ScreenTimeEnforcer matches the running process against it.
    struct AppLimit
    {
        public int appId;
        public string exeName;
        public string fileDescription;
        public string path;
        public string[] allPaths;
        public int dailyLimitMinutes;
    }
}
