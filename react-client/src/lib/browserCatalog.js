// Hardcoded catalog of browsers an admin can allow/disallow per device.
//
// exeName is the bare process name (Process.ProcessName convention, no .exe
// extension) - must match trayapp/DisallowedBrowserEnforcer.cs's comparison.
// pathSubstring is a case-insensitive fragment of the install path required
// alongside exeName for a match, since several browsers share generic exe
// names (chrome.exe: Chrome vs Chromium; launcher.exe/browser.exe: Opera GX,
// Yandex, Coc Coc) - leave it "" only for exe names that are already unique.
//
// exeNamePartial opts a browser into substring (rather than exact) matching
// on exeName, for browsers that bake a dynamic version/timestamp into their
// exe name itself, making exact matching impossible (e.g. Wave Browser ships
// as "Wave Browser - 2026-09-05T214756.981.exe", a fresh name every install/
// update). Defaults to false (exact match) everywhere else - partial exeName
// matching is opt-in per entry since it risks false positives for short/
// generic names.
//
// `id` is the stable key used by the UI/state (NOT exeName, since exeName
// alone isn't unique across entries - e.g. Chrome and Chromium share
// "chrome").
//
// exeName/pathSubstring values for the less common browsers are best-effort
// and should be spot-checked against real installs before shipping - a wrong
// guess means that browser silently can't be blocked.
export const BROWSER_CATALOG = [
  { id: 'chrome', label: 'Google Chrome', exeName: 'chrome', pathSubstring: 'Google\\Chrome', exeNamePartial: false },
  { id: 'chromium', label: 'Chromium', exeName: 'chrome', pathSubstring: 'Chromium', exeNamePartial: false },
  { id: 'firefox', label: 'Mozilla Firefox', exeName: 'firefox', pathSubstring: 'Firefox', exeNamePartial: false },
  { id: 'msedge', label: 'Microsoft Edge', exeName: 'msedge', pathSubstring: 'Microsoft\\Edge', exeNamePartial: false },
  { id: 'brave', label: 'Brave', exeName: 'brave', pathSubstring: 'BraveSoftware', exeNamePartial: false },
  { id: 'opera', label: 'Opera', exeName: 'opera', pathSubstring: '\\Opera\\', exeNamePartial: false },
  { id: 'operagx', label: 'Opera GX', exeName: 'opera', pathSubstring: 'Opera GX', exeNamePartial: false },
  { id: 'vivaldi', label: 'Vivaldi', exeName: 'vivaldi', pathSubstring: 'Vivaldi', exeNamePartial: false },
  { id: 'tor', label: 'Tor Browser', exeName: 'firefox', pathSubstring: 'Tor Browser', exeNamePartial: false },
  { id: 'yandex', label: 'Yandex Browser', exeName: 'browser', pathSubstring: 'Yandex', exeNamePartial: false },
  { id: 'coccoc', label: 'Coc Coc', exeName: 'browser', pathSubstring: 'CocCoc', exeNamePartial: false },
  { id: 'ucbrowser', label: 'UC Browser', exeName: 'ucbrowser', pathSubstring: 'UCBrowser', exeNamePartial: false },
  { id: 'maxthon', label: 'Maxthon', exeName: 'maxthon', pathSubstring: 'Maxthon', exeNamePartial: false },
  { id: 'dragon', label: 'Comodo Dragon', exeName: 'dragon', pathSubstring: 'Comodo\\Dragon', exeNamePartial: false },
  { id: 'epic', label: 'Epic Privacy Browser', exeName: 'epic', pathSubstring: 'Epic Privacy Browser', exeNamePartial: false },
  { id: 'aswsecurebrowser', label: 'Avast Secure Browser', exeName: 'aswsecurebrowser', pathSubstring: 'Avast Software', exeNamePartial: false },
  { id: 'avgsecurebrowser', label: 'AVG Secure Browser', exeName: 'avgsecurebrowser', pathSubstring: 'AVG Secure Browser', exeNamePartial: false },
  { id: 'puffin', label: 'Puffin', exeName: 'puffin', pathSubstring: 'Puffin', exeNamePartial: false },
  { id: 'waterfox', label: 'Waterfox', exeName: 'waterfox', pathSubstring: 'Waterfox', exeNamePartial: false },
  { id: 'palemoon', label: 'Pale Moon', exeName: 'palemoon', pathSubstring: 'Pale Moon', exeNamePartial: false },
  { id: 'seamonkey', label: 'SeaMonkey', exeName: 'seamonkey', pathSubstring: 'SeaMonkey', exeNamePartial: false },
  { id: 'whale', label: 'Naver Whale', exeName: 'whale', pathSubstring: 'Naver\\Whale', exeNamePartial: false },
  { id: 'sleipnir', label: 'Sleipnir', exeName: 'sleipnir', pathSubstring: 'Sleipnir', exeNamePartial: false },
  { id: 'slimjet', label: 'Slimjet', exeName: 'slimjet', pathSubstring: 'Slimjet', exeNamePartial: false },
  { id: 'centbrowser', label: 'CentBrowser', exeName: 'chrome', pathSubstring: 'CentBrowser', exeNamePartial: false },
  { id: 'baidubrowser', label: 'Baidu Browser', exeName: 'baidubrowser', pathSubstring: 'Baidu', exeNamePartial: false },
  { id: 'qqbrowser', label: 'QQ Browser', exeName: 'qqbrowser', pathSubstring: 'Tencent\\QQBrowser', exeNamePartial: false },
  { id: '360browser', label: '360 Browser', exeName: '360se', pathSubstring: '360Chrome', exeNamePartial: false },
  { id: 'midori', label: 'Midori', exeName: 'midori', pathSubstring: 'Midori', exeNamePartial: false },
  { id: 'iexplore', label: 'Internet Explorer', exeName: 'iexplore', pathSubstring: 'Internet Explorer', exeNamePartial: false },
  // Wave Browser's exe name is versioned/timestamped per install/update (e.g.
  // "Wave Browser - 2026-09-05T214756.981.exe"), so exact exeName matching
  // can never work - both exeName and pathSubstring match on the "Wave
  // Browser" fragment common to every version, observed installing under
  // {drive}\Users\{user}\Downloads\Wave Browser - <timestamp>\.
  { id: 'wavebrowser', label: 'Wave Browser', exeName: 'wave browser', pathSubstring: 'Wave Browser', exeNamePartial: true },
  // The following are mostly Chromium-based adware/PUP browsers bundled with
  // free software installers - exactly the kind a parent would want blocked.
  { id: 'torch', label: 'Torch Browser', exeName: 'torch', pathSubstring: 'Torch\\Application', exeNamePartial: false },
  { id: 'amigo', label: 'Amigo (Mail.ru)', exeName: 'amigo', pathSubstring: 'Amigo\\Application', exeNamePartial: false },
  { id: 'orbitum', label: 'Orbitum', exeName: 'orbitum', pathSubstring: 'Orbitum\\Application', exeNamePartial: false },
  { id: 'chedot', label: 'Chedot', exeName: 'chedot', pathSubstring: 'Chedot\\Application', exeNamePartial: false },
  { id: 'kometa', label: 'Kometa (Комета)', exeName: 'kometa', pathSubstring: 'Kometa\\Application', exeNamePartial: false },
  { id: 'citrio', label: 'Citrio', exeName: 'citrio', pathSubstring: 'CatalinaGroup\\Citrio', exeNamePartial: false },
  { id: 'iridium', label: 'Iridium Browser', exeName: 'iridium', pathSubstring: 'Iridium', exeNamePartial: false },
  { id: 'blisk', label: 'Blisk', exeName: 'blisk', pathSubstring: 'Blisk\\Application', exeNamePartial: false },
  { id: 'kmeleon', label: 'K-Meleon', exeName: 'k-meleon', pathSubstring: 'K-Meleon', exeNamePartial: false },
  // DuckDuckGo's Windows browser is MSIX/Store-packaged - pathSubstring
  // matches its package folder name, but on-disk paths for MSIX apps are
  // less predictable than a normal installer's; worth a real-install check.
  { id: 'duckduckgo', label: 'DuckDuckGo Browser', exeName: 'duckduckgo', pathSubstring: 'DuckDuckGo.DesktopBrowser', exeNamePartial: false },
]
