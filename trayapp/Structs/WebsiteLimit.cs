namespace trayapp.Structs
{
    // Mirrors the server's /api/website-limits row (see server WebsiteLimit model) -
    // just the configured number, keyed by domain. Unlike AppLimit, the trayapp
    // computes usage against this itself (see TabActivityStore); the server never
    // does that calculation.
    struct WebsiteLimit
    {
        public string domain;
        public int dailyLimitMinutes;
    }
}
