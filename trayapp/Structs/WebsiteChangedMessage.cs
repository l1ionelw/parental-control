namespace trayapp.Structs
{
    // Wire shape for a tab switch, relayed to the remote server on behalf of the
    // chrome extension - matches what the extension used to send directly (see
    // server/browser_ws.py.handle_website_changed). The server closes whatever
    // session it had open and opens a new one for 'after'.
    struct WebsiteChangedMessage
    {
        public string type;
        public WebsiteTab after;
        public long switchTime;
    }

    // Wire shape for a tab heartbeat - keeps the remote server's open session's
    // endTime moving forward (see server/browser_ws.py.handle_website_heartbeat).
    struct WebsiteHeartbeatMessage
    {
        public string type;
        public WebsiteTab tab;
        public long timestamp;
    }

    struct WebsiteTab
    {
        public string url;
        public string title;
    }
}
