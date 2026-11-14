# MobView Privacy Policy

This policy covers the MobView extension for Chrome. MobView switches selected websites to their mobile version by changing the User-Agent your browser presents to them.

## Information stored on your device

MobView reads tab URLs to identify each site and show whether mobile view is on. It stores the domains you enable, your optional custom User-Agent, and your reload preference in local Chrome extension storage. It does not keep a log of the pages you visit.

On enabled sites, MobView temporarily caches the effective User-Agent in that tab's session storage so the extension can present it consistently across reloads. Scripts on the same site can read that value while the tab stays open.

## Information sent to websites

When mobile view is enabled, requests for documents on enabled sites carry the selected User-Agent. Requests for resources loaded by those pages can carry it too, including when a resource is hosted on a different domain. The browser sends the header to the server that receives the request. MobView does not transmit your saved site list or preferences to a developer server, and it does not use analytics, advertising or telemetry.

MobView uses site information only to provide the mobile view and remember where you turned it on. MobView's use of information from Chrome APIs follows the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Managing and deleting your settings

Open MobView Options to remove a saved site or change your preferences. Chrome removes the extension's local settings when you uninstall MobView. Turning off mobile view for a site or closing the tab clears the session storage entry on that site.

For privacy questions, use the MobView project’s GitHub issues page. Avoid including personal information in public issues. [MobView support](https://github.com/csjune/MobView/issues)
