# MobView

Firefox extension that switches chosen sites to their mobile view with one click.

Click the toolbar button on any site to toggle mobile view for that site only; every
other site stays untouched. Enabled sites are remembered and can be managed from the
options page, where you can also set your own user-agent string.

MobView does not collect or transmit any data. Requires Firefox 140 or later.

## Attribution

MobView is a modified version of **Mobile View Switcher** 0.2.2 by Bernard
(https://addons.mozilla.org/firefox/addon/mobile-view-switcher/), which is licensed
under the Mozilla Public License 2.0.

Icons (`src/data/icons/`) are original artwork made for MobView.

### Changes from Mobile View Switcher

- Mobile view is enabled per site (base domain) instead of globally; the toolbar icon
  shows ON/OFF for each tab.
- Options page lists enabled sites with a Remove button; supports dark mode.
- Content scripts run only on enabled sites instead of every page.
- Third-party iframes on an enabled site stay in desktop mode.
- Changing the user-agent string in the options applies immediately.
- "Bypass cache when reloading" option now takes effect.
- Removed the keyboard shortcut and the automatic `m.` → desktop URL redirect.
- Removed welcome/uninstall pages, support and donation links.
- Background code refactored and simplified.

## License

[Mozilla Public License 2.0](LICENSE)
