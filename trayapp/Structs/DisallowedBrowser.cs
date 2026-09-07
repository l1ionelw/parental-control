namespace trayapp.Structs
{
    // exeName is the bare process name (Process.ProcessName convention, no
    // .exe extension). pathSubstring disambiguates exe names that collide
    // across browsers (e.g. chrome.exe: Chrome vs Chromium) - may be empty
    // for exe names that are already unambiguous.
    internal struct DisallowedBrowser
    {
        public string id;
        public string exeName;
        public string pathSubstring;
    }
}
