namespace trayapp.Structs
{
    // exeName is the bare process name (Process.ProcessName convention, no
    // .exe extension). pathSubstring disambiguates exe names that collide
    // across browsers (e.g. chrome.exe: Chrome vs Chromium) - may be empty
    // for exe names that are already unambiguous. exeNamePartial opts a
    // browser into substring (rather than exact) matching on exeName, for
    // browsers that bake a dynamic version/timestamp into their exe name
    // itself (e.g. Wave Browser's "Wave Browser - 2026-09-05T214756.981.exe")
    // so an exact match can never succeed - default false (exact match) since
    // partial exeName matching risks false positives for common short names.
    internal struct DisallowedBrowser
    {
        public string id;
        public string exeName;
        public string pathSubstring;
        public bool exeNamePartial;
    }
}
