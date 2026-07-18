namespace trayapp.Structs
{
    // Mirrors the server's /api/block-exceptions row merged with its Application
    // (see server.py _build_block_exceptions_payload) - an app no enforcement
    // (downtime, screen-time limit, manual block) is allowed to terminate.
    struct AlwaysAllowedApp
    {
        public int appId;
        public string exeName;
        public string fileDescription;
        public string path;
        public string[] allPaths;
    }
}
