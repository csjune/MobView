# MobView Privacy Policy

This policy covers the MobView extension for Chrome. MobView switches selected websites to their mobile version by changing the User-Agent and related browser hints your browser presents to them.

## Information stored on your device

MobView reads tab URLs to identify each site and show whether mobile view is on. It stores the domains you enable, your optional custom User-Agent, and your reload preference in local Chrome extension storage. It does not keep a log of the pages you visit.

On enabled sites, MobView temporarily caches the effective User-Agent under the `"mobview-useragent"` key in `sessionStorage` only for enabled-site frames (not third-party iframes), so the extension can present it consistently across reloads. Scripts on the same origin can read that value while the tab stays open. MobView never writes to `localStorage`, and clears any legacy `"mobview-useragent"` key from `localStorage` if present.

## Information sent to websites

When mobile view is enabled, requests for top-level documents on enabled sites, subframes initiated by enabled sites, and subresources initiated by enabled pages (including resources hosted on another domain) carry the selected `User-Agent` header instead of your desktop `User-Agent`. On those requests in Chrome, MobView also removes desktop high-entropy Client Hint headers (`sec-ch-ua-arch`, `sec-ch-ua-bitness`, `sec-ch-ua-form-factors`, `sec-ch-ua-full-version`, `sec-ch-ua-full-version-list`, `sec-ch-ua-model`, `sec-ch-ua-platform-version`, `sec-ch-ua-wow64`), removes low-entropy hints (`sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`) on plain HTTP or when emulating non-Chromium browsers, and replaces those three low-entropy headers on HTTPS with values matching your configured Chromium `User-Agent`. In page scripts on those frames, MobView also aligns `navigator` properties (such as `userAgent`, `platform`, `vendor`, and `maxTouchPoints`) and `navigator.userAgentData` (exposing matching low-entropy and requested hints when emulating a Chromium User-Agent, or hiding `navigator.userAgentData` for non-Chromium User-Agents).

The browser sends HTTP request headers only to the server that receives each request. MobView does not transmit your saved site list or preferences to a developer server, and it does not use analytics, advertising, or telemetry.

MobView uses site information only to provide the mobile view and remember where you turned it on. MobView's use of information from Chrome APIs follows the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Managing and deleting your settings

Open MobView Options to add or remove saved sites or change your preferences. Chrome removes the extension's local settings when you uninstall MobView. Turning off mobile view for a site clears `"mobview-useragent"` from `sessionStorage` in currently open tabs at that site; entries on previously visited origins in tab history, discarded tabs, or closed tabs clear when the tab ends or the browser session closes.

For privacy questions, use the MobView project’s GitHub issues page. Avoid including personal information in public issues. [MobView support](https://github.com/csjune/MobView/issues)
