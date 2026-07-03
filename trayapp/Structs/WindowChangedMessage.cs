using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace trayapp.Structs
{
    struct WindowChangedMessage
    {
        public string type;
        public string exeName;
        public string friendlyName;
        public string path;
    }
}
