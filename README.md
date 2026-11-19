# MobView

Firefox and Chrome extension that switches chosen sites to their mobile view with one click.

Click the toolbar button on any site to toggle mobile view for that site only; every
other site stays untouched. Enabled sites are remembered and can be managed from the
options page, where you can manually add a URL or hostname directly (saving the entered
hostname as provided), remove saved sites, or set your own user-agent string.

MobView stores site choices and preferences on your device and does not use analytics.
Requires Firefox 140 (142 on Android) or Chrome 119 or later.

## Install in Chrome

1. Run `npm install` and `npm run build:chrome` to build the extension. This creates
   `dist/chrome/` and `dist/mobview-chrome-<version>.zip`.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select `dist/chrome/`. If you already have the ZIP,
   extract it and select the folder containing `manifest.json`.
4. Pin MobView from the Extensions menu, then click its icon on a site to toggle
   mobile view for that site.

Use `npm run build` to build the Firefox XPI, `npm start` to run temporarily in Firefox, and `npm test` / `npm run lint` to verify.

[MobView privacy policy for Chrome](docs/chrome-web-store/privacy-policy.md)

## Permissions

- `storage`: stores enabled sites, custom User-Agent, and reload preferences locally on your device.
- `scripting`: registers content scripts only for enabled sites and syncs or clears per-tab `sessionStorage` when toggling or updating the User-Agent.
- `declarativeNetRequest`: modifies the `User-Agent` header (and strips desktop `Sec-CH-UA*` Client Hint headers in Chrome) on matching requests for enabled sites.
- `*://*/*`: allows applying mobile User-Agent rules, toolbar state, and content scripts to any HTTP or HTTPS site you enable.

## Attribution

MobView is a modified version of **Mobile View Switcher** 0.2.2 by Bernard
(https://addons.mozilla.org/firefox/addon/mobile-view-switcher/), which is licensed
under the Mozilla Public License 2.0.

Icons (`src/data/icons/`) are original artwork made for MobView.

### Changes from Mobile View Switcher

- Mobile view is enabled per site instead of globally (base domain when toggled from the
  toolbar, or the entered hostname as provided when added manually); the toolbar icon
  shows ON/OFF for each tab.
- Options page lists enabled sites under **Mobile View Sites**, lets you manually add a
  URL or hostname directly or remove entries, and supports dark mode.
- Content scripts run only on enabled sites instead of every page.
- Bidirectional iframe isolation: third-party iframes inside an enabled site stay in
  desktop mode, and enabled sites embedded as third-party iframes inside a desktop page
  also stay in desktop mode (note: due to DNR `initiatorDomains` matching the frame's
  own origin, embedded enabled-origin frames still use desktop document/JS `navigator`,
  but subresource requests they initiate directly carry the mobile `User-Agent` header).
- Browser-specific default User-Agent strings (Firefox for Android in the Firefox build;
  Chrome for Android in the Chrome build) and printable-ASCII validation for custom
  User-Agent strings.
- Handles Chrome `Sec-CH-UA*` Client Hint headers (always removing high-entropy hints, removing low-entropy hints on HTTP or non-Chromium User-Agents, and aligning `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform` on HTTPS for Chromium User-Agents) and aligns `navigator` properties and `navigator.userAgentData` (or hides `navigator.userAgentData` for non-Chromium User-Agents).
- Changing the user-agent string in options applies immediately (removed the separate
  Options **Test** button).
- "Bypass cache when reloading" option now takes effect.
- Removed the right-click context menu (`contextMenus`), the keyboard shortcut, and the
  automatic `m.` → desktop URL redirect.
- Removed welcome/uninstall pages, support and donation links.
- Background code refactored and simplified.

## License

[Mozilla Public License 2.0](LICENSE)
