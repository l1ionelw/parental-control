using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace trayapp.Structs
{
    // Reports a finished, legitimate focus session: the app the user was using from
    // startTime..endTime. Only sessions of at least the minimum length are reported,
    // so every message is a real usage block. The app switched to is not included –
    // it will be the 'previous' of the next message (if it lasts long enough). Times
    // are Unix milliseconds (UTC).
    struct WindowChangedMessage
    {
        public string type;
        public long startTime;      // when 'previous' gained focus
        public long endTime;        // when focus left 'previous' (switch moment)
        public Application previous; // the app we were using during the session
    }
}
