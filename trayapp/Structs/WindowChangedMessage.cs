using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace trayapp.Structs
{
    // Reports a window switch: the app used from startTime..endTime ('previous'),
    // and the app just switched to ('current'). Sent on every switch, no matter
    // how short - 'current' lets the server keep a live "what's focused right
    // now" cache in sync in real time, same as it does for browser tabs. Whether
    // 'previous' is actually persisted into history/usage is a separate decision
    // the server makes based on its duration (see trayapp_ws._handle_window_changed) -
    // this struct doesn't encode that, it's on every message unconditionally.
    // Times are Unix milliseconds (UTC).
    struct WindowChangedMessage
    {
        public string type;
        public long startTime;      // when 'previous' gained focus
        public long endTime;        // when focus left 'previous' == when 'current' gained it
        public Application previous; // the app we were using during the session
        public Application current;  // the app just switched to
    }
}
