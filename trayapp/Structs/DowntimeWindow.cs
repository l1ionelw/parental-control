namespace trayapp.Structs
{
    // Mirrors one row of the server's /api/downtime list (see models.Downtime).
    struct DowntimeWindow
    {
        public int id;
        public int startMinute;
        public int endMinute;
        public bool enabled;
    }
}
