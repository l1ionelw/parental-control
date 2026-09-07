// Hardcoded catalog of browsers an admin can allow/disallow per device.
//
// exeName is the bare process name (Process.ProcessName convention, no .exe
// extension) - must match trayapp/DisallowedBrowserEnforcer.cs's comparison.
// pathSubstring is a case-insensitive fragment of the install path required
// alongside exeName for a match, since several browsers share generic exe
// names (chrome.exe: Chrome vs Chromium; launcher.exe/browser.exe: Opera GX,
// Yandex, Coc Coc) - leave it "" only for exe names that are already unique.
//
// `id` is the stable key used by the UI/state (NOT exeName, since exeName
// alone isn't unique across entries - e.g. Chrome and Chromium share
// "chrome").
//
// exeName/pathSubstring values for the less common browsers are best-effort
// and should be spot-checked against real installs before shipping - a wrong
// guess means that browser silently can't be blocked.
export const BROWSER_CATALOG = [
  { id: 'chrome', label: 'Google Chrome', exeName: 'chrome', pathSubstring: 'Google\\Chrome' },
  { id: 'chromium', label: 'Chromium', exeName: 'chrome', pathSubstring: 'Chromium' },
  { id: 'firefox', label: 'Mozilla Firefox', exeName: 'firefox', pathSubstring: 'Firefox' },
  { id: 'msedge', label: 'Microsoft Edge', exeName: 'msedge', pathSubstring: 'Microsoft\\Edge' },
  { id: 'brave', label: 'Brave', exeName: 'brave', pathSubstring: 'BraveSoftware' },
  { id: 'opera', label: 'Opera', exeName: 'opera', pathSubstring: '\\Opera\\' },
  { id: 'operagx', label: 'Opera GX', exeName: 'opera', pathSubstring: 'Opera GX' },
  { id: 'vivaldi', label: 'Vivaldi', exeName: 'vivaldi', pathSubstring: 'Vivaldi' },
  { id: 'tor', label: 'Tor Browser', exeName: 'firefox', pathSubstring: 'Tor Browser' },
  { id: 'yandex', label: 'Yandex Browser', exeName: 'browser', pathSubstring: 'Yandex' },
  { id: 'coccoc', label: 'Coc Coc', exeName: 'browser', pathSubstring: 'CocCoc' },
  { id: 'ucbrowser', label: 'UC Browser', exeName: 'ucbrowser', pathSubstring: 'UCBrowser' },
  { id: 'maxthon', label: 'Maxthon', exeName: 'maxthon', pathSubstring: 'Maxthon' },
  { id: 'dragon', label: 'Comodo Dragon', exeName: 'dragon', pathSubstring: 'Comodo\\Dragon' },
  { id: 'epic', label: 'Epic Privacy Browser', exeName: 'epic', pathSubstring: 'Epic Privacy Browser' },
  { id: 'aswsecurebrowser', label: 'Avast Secure Browser', exeName: 'aswsecurebrowser', pathSubstring: 'Avast Software' },
  { id: 'avgsecurebrowser', label: 'AVG Secure Browser', exeName: 'avgsecurebrowser', pathSubstring: 'AVG Secure Browser' },
  { id: 'puffin', label: 'Puffin', exeName: 'puffin', pathSubstring: 'Puffin' },
  { id: 'waterfox', label: 'Waterfox', exeName: 'waterfox', pathSubstring: 'Waterfox' },
  { id: 'palemoon', label: 'Pale Moon', exeName: 'palemoon', pathSubstring: 'Pale Moon' },
  { id: 'seamonkey', label: 'SeaMonkey', exeName: 'seamonkey', pathSubstring: 'SeaMonkey' },
  { id: 'whale', label: 'Naver Whale', exeName: 'whale', pathSubstring: 'Naver\\Whale' },
  { id: 'sleipnir', label: 'Sleipnir', exeName: 'sleipnir', pathSubstring: 'Sleipnir' },
  { id: 'slimjet', label: 'Slimjet', exeName: 'slimjet', pathSubstring: 'Slimjet' },
  { id: 'centbrowser', label: 'CentBrowser', exeName: 'chrome', pathSubstring: 'CentBrowser' },
  { id: 'baidubrowser', label: 'Baidu Browser', exeName: 'baidubrowser', pathSubstring: 'Baidu' },
  { id: 'qqbrowser', label: 'QQ Browser', exeName: 'qqbrowser', pathSubstring: 'Tencent\\QQBrowser' },
  { id: '360browser', label: '360 Browser', exeName: '360se', pathSubstring: '360Chrome' },
  { id: 'midori', label: 'Midori', exeName: 'midori', pathSubstring: 'Midori' },
  { id: 'iexplore', label: 'Internet Explorer', exeName: 'iexplore', pathSubstring: 'Internet Explorer' },
  { id: 'wavebrowser', label: 'Wave Browser', exeName: 'wavebrowser', pathSubstring: 'Wave\\Application' },
  // The following are mostly Chromium-based adware/PUP browsers bundled with
  // free software installers - exactly the kind a parent would want blocked.
  { id: 'torch', label: 'Torch Browser', exeName: 'torch', pathSubstring: 'Torch\\Application' },
  { id: 'amigo', label: 'Amigo (Mail.ru)', exeName: 'amigo', pathSubstring: 'Amigo\\Application' },
  { id: 'orbitum', label: 'Orbitum', exeName: 'orbitum', pathSubstring: 'Orbitum\\Application' },
  { id: 'chedot', label: 'Chedot', exeName: 'chedot', pathSubstring: 'Chedot\\Application' },
  { id: 'kometa', label: 'Kometa (Комета)', exeName: 'kometa', pathSubstring: 'Kometa\\Application' },
  { id: 'citrio', label: 'Citrio', exeName: 'citrio', pathSubstring: 'CatalinaGroup\\Citrio' },
  { id: 'iridium', label: 'Iridium Browser', exeName: 'iridium', pathSubstring: 'Iridium' },
  { id: 'blisk', label: 'Blisk', exeName: 'blisk', pathSubstring: 'Blisk\\Application' },
  { id: 'kmeleon', label: 'K-Meleon', exeName: 'k-meleon', pathSubstring: 'K-Meleon' },
  // DuckDuckGo's Windows browser is MSIX/Store-packaged - pathSubstring
  // matches its package folder name, but on-disk paths for MSIX apps are
  // less predictable than a normal installer's; worth a real-install check.
  { id: 'duckduckgo', label: 'DuckDuckGo Browser', exeName: 'duckduckgo', pathSubstring: 'DuckDuckGo.DesktopBrowser' },
]
