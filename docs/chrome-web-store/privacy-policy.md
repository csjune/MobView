# MobView Privacy Policy

This policy covers the MobView extension for Chrome. MobView switches selected websites to their mobile version by changing the User-Agent your browser presents to them.

## Information stored on your device

MobView reads tab URLs to identify each site and show whether mobile view is on. It stores the domains you enable, your optional custom User-Agent, and your reload preference in local Chrome extension storage. It does not keep a log of the pages you visit.

On enabled sites, MobView also stores the effective User-Agent in that site's browser storage so the extension can present it to page scripts. Scripts on the same site can read that value.

## Information sent to websites

When mobile view is enabled, requests for documents on enabled sites carry the selected User-Agent. Requests for resources loaded by those pages can carry it too, including when a resource is hosted on a different domain. The browser sends the header to the server that receives the request. MobView does not transmit your saved site list or preferences to a developer server, and it does not use analytics, advertising or telemetry.

If you choose **What is my UserAgent?**, MobView opens a third-party test page on WebBrowserTools.com. That website receives the information Chrome normally sends when opening a webpage, such as your IP address and the User-Agent used for that request. The third party handles that information under its own practices.

MobView uses site information only to provide the mobile view and remember where you turned it on. MobView's use of information from Chrome APIs follows the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Managing and deleting your settings

Open MobView Options to remove a saved site or change your preferences. Chrome removes the extension's local settings when you uninstall MobView. To remove the User-Agent value that was stored on an enabled site, clear that site's data in Chrome.

For privacy questions, use the MobView project’s GitHub issues page. Avoid including personal information in public issues. [MobView support](https://github.com/csjune/MobView/issues)
