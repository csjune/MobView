# MobView

Firefox and Chrome extension that switches individual sites to their mobile view with one click.

Click the toolbar button to toggle mobile view for the current site only—other sites stay untouched. Manage saved sites (including manual URL/host input) and custom User-Agent strings in Options. All settings stay on your device with no analytics.

Requires Firefox 140+ (142+ on Android) or Chrome 119+.

## Install

- [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/mobview/)
- [Chrome Web Store](https://chromewebstore.google.com/detail/mobview/jliinjpifkfjenmepnilkklbebmbhnjm)

## Permissions

- `storage`: save enabled sites, custom User-Agent, and reload preferences locally.
- `scripting`: inject content scripts only on enabled sites and sync per-tab `sessionStorage`.
- `declarativeNetRequest`: override `User-Agent` (and adjust `Sec-CH-UA*` Client Hints in Chrome) on enabled sites.
- `*://*/*`: apply rules, scripts, and toolbar state to any HTTP/HTTPS site you enable.

[Privacy policy (Chrome)](docs/chrome-web-store/privacy-policy.md)

## Build & Test

Requires Node.js 20+.

```sh
npm install
npm run build        # Firefox XPI (dist/mobview-<version>.xpi)
npm run build:chrome # Chrome folder (dist/chrome/) & ZIP
npm start            # Run temporarily in Firefox
npm test             # Run tests
npm run lint         # Run web-ext lint
```

To load unpacked in Chrome, open `chrome://extensions`, enable **Developer mode**, and load `dist/chrome/`.

## Attribution & License

Based on **[Mobile View Switcher](https://addons.mozilla.org/firefox/addon/mobile-view-switcher/)** 0.2.2 by Bernard ([MPL-2.0](LICENSE)). Icons (`src/data/icons/`) are original artwork for MobView.

Key changes from Mobile View Switcher:
- Per-site mobile mode (toolbar toggle or manual URL/host input in Options) instead of global switching, with per-tab ON/OFF icons and dark mode.
- Content scripts and request rules run only on enabled sites, with bidirectional third-party iframe isolation.
- Browser-specific default mobile User-Agents, Chrome `Sec-CH-UA*` / `navigator.userAgentData` alignment, and instant User-Agent updates with ASCII validation.
- Working "Bypass cache when reloading" option; removed `contextMenus`, keyboard shortcut, `m.` auto-redirect, and welcome/donation pages.
