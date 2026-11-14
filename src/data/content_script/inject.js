/* registered only for the mobile view sites; hands the user-agent to page_context/inject.js */
{
  const getTopHostname = function () {
    if (typeof window === "undefined" || !window.top || window === window.top) return null;
    try {
      const topHost = window.top.location && window.top.location.hostname;
      if (topHost) return topHost;
    } catch (err) {}
    if (typeof location !== "undefined" && location.ancestorOrigins && location.ancestorOrigins.length) {
      const topOrigin = location.ancestorOrigins[location.ancestorOrigins.length - 1];
      if (!topOrigin || topOrigin === "null") return "";
      try {
        return new URL(topOrigin).hostname;
      } catch (err) {
        return "";
      }
    }
    if (window.parent === window.top && typeof document !== "undefined" && document.referrer) {
      try {
        return new URL(document.referrer).hostname;
      } catch (err) {
        return null;
      }
    }
    return null;
  };
  /*  */
  const isExactHost = function (host) {
    return host.startsWith("[") || host.indexOf(".") === -1 || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  };
  /*  */
  const matchesSite = function (hostname, sites) {
    if (!sites) return true;
    const host = typeof hostname === "string" ? hostname.trim().toLowerCase().replace(/\.+$/, "") : "";
    if (!host) return false;
    return sites.some(function (site) {
      if (typeof site !== "string") return false;
      const normalizedSite = site.trim().toLowerCase().replace(/\.+$/, "");
      if (!normalizedSite) return false;
      if (isExactHost(host) || isExactHost(normalizedSite)) {
        return host === normalizedSite;
      }
      return host === normalizedSite || host.endsWith("." + normalizedSite);
    });
  };
  /*  */
  const dispatchUA = function (ua) {
    try {
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("mobview-useragent", {"detail": ua}));
      }
    } catch (err) {}
  };
  /*  */
  chrome.storage.local.get(["sites", "useragent"], function (e) {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError) return;
    try {
      if (typeof localStorage !== "undefined" && localStorage) localStorage.removeItem("mobview-useragent");
    } catch (err) {}
    /*  */
    const topHostname = getTopHostname();
    const sites = e && Array.isArray(e.sites) ? e.sites : null;
    if (topHostname !== null && !matchesSite(topHostname, sites)) {
      try {
        if (typeof sessionStorage !== "undefined" && sessionStorage) sessionStorage.removeItem("mobview-useragent");
      } catch (err) {}
      dispatchUA("");
      return;
    }
    /*  */
    const rawUA = e && typeof e.useragent === "string" ? e.useragent.replace(/[\r\n\t]+/g, " ").trim() : "";
    const ua = rawUA && !/[^\x20-\x7E]/.test(rawUA) ? rawUA : defaults.useragent;
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage) sessionStorage.setItem("mobview-useragent", ua);
    } catch (err) {}
    dispatchUA(ua);
  });
}
