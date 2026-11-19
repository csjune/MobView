/* registered only for the mobile view sites; hands the user-agent to page_context/inject.js */
{
  const normalizeHost = function (value) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim().toLowerCase().replace(/\.+$/, "");
    if (!trimmed || trimmed.indexOf("..") !== -1 || trimmed[0] === ".") return "";
    return trimmed;
  };
  /*  */
  const isIpv4 = function (host) {
    const parts = host.split(".");
    return parts.length === 4 && parts.every(function (part) {
      return /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255;
    });
  };
  /*  */
  const isExactHost = function (host) {
    return host.startsWith("[") || host.indexOf(".") === -1 || isIpv4(host);
  };
  /*  */
  const matchesSite = function (hostname, sites) {
    if (!Array.isArray(sites) || !sites.length) return false;
    const host = normalizeHost(hostname);
    if (!host) return false;
    const hostExact = isExactHost(host);
    return sites.some(function (site) {
      const normalizedSite = normalizeHost(site);
      if (!normalizedSite) return false;
      if (host === normalizedSite) return true;
      return !hostExact && !isExactHost(normalizedSite) && host.endsWith("." + normalizedSite);
    });
  };
  /*  */
  const getTopFrameState = function () {
    if (typeof window === "undefined" || !window.top || window === window.top) {
      return {"kind": "top"};
    }
    try {
      const topHost = window.top.location && window.top.location.hostname;
      if (topHost) return {"kind": "host", "hostname": topHost};
    } catch (err) {}
    if (typeof location !== "undefined" && location.ancestorOrigins && location.ancestorOrigins.length) {
      const topOrigin = location.ancestorOrigins[location.ancestorOrigins.length - 1];
      if (!topOrigin || topOrigin === "null") return {"kind": "blocked"};
      try {
        const parsedHost = new URL(topOrigin).hostname;
        return parsedHost ? {"kind": "host", "hostname": parsedHost} : {"kind": "blocked"};
      } catch (err) {
        return {"kind": "blocked"};
      }
    }
    return {"kind": "askBackground"};
  };
  /*  */
  const randomToken = function () {
    try {
      if (typeof crypto !== "undefined" && crypto && typeof crypto.getRandomValues === "function") {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        let hex = "";
        for (let i = 0; i < bytes.length; i += 1) {
          hex += bytes[i].toString(16).padStart(2, "0");
        }
        return hex;
      }
    } catch (err) {}
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  };
  /*  */
  const channel = "mobview-ua-" + randomToken();
  let handshaked = false;
  let hasResolved = false;
  let resolvedUA = "";
  /*  */
  const dispatchChannelEvent = function (type, detail, cancelable) {
    try {
      if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
        const init = cancelable ? {"detail": detail, "cancelable": true} : {"detail": detail};
        return window.dispatchEvent(new CustomEvent(type, init));
      }
    } catch (err) {}
    return true;
  };
  /*  */
  const onReady = function (event) {
    if (event && typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    try {
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("mobview-ready", onReady, true);
      }
    } catch (err) {}
    handshaked = true;
    dispatchChannelEvent("mobview-channel", channel, true);
    if (hasResolved) dispatchChannelEvent(channel, resolvedUA, false);
  };
  /*  */
  try {
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("mobview-ready", onReady, true);
    }
    if (dispatchChannelEvent("mobview-channel", channel, true) === false) {
      handshaked = true;
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("mobview-ready", onReady, true);
      }
    }
  } catch (err) {}
  /*  */
  const deliverUA = function (ua) {
    hasResolved = true;
    resolvedUA = ua;
    if (handshaked) {
      dispatchChannelEvent(channel, ua, false);
    } else {
      dispatchChannelEvent("mobview-useragent", ua, false);
    }
  };
  /*  */
  const clearSession = function () {
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage) sessionStorage.removeItem("mobview-useragent");
    } catch (err) {}
  };
  /*  */
  const writeSession = function (ua) {
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage) sessionStorage.setItem("mobview-useragent", ua);
    } catch (err) {}
  };
  /*  */
  const sanitizeUA = function (raw) {
    const normalized = typeof raw === "string" ? raw.replace(/[\r\n\t]+/g, " ").trim() : "";
    return normalized && /^[\x20-\x7E]+$/.test(normalized) ? normalized : defaults.useragent;
  };
  /*  */
  const applyResolved = function (ua) {
    const cleanUA = sanitizeUA(ua);
    writeSession(cleanUA);
    deliverUA(cleanUA);
  };
  /*  */
  const blockFrame = function () {
    clearSession();
    deliverUA("");
  };
  /*  */
  chrome.storage.local.get(["sites", "useragent"], function (e) {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError) return;
    try {
      if (typeof localStorage !== "undefined" && localStorage) localStorage.removeItem("mobview-useragent");
    } catch (err) {}
    /*  */
    const state = getTopFrameState();
    if (state.kind === "blocked") {
      blockFrame();
      return;
    }
    if (state.kind === "host") {
      const sites = e && Array.isArray(e.sites) ? e.sites : null;
      if (!matchesSite(state.hostname, sites)) {
        blockFrame();
        return;
      }
      applyResolved(e && e.useragent);
      return;
    }
    if (state.kind === "askBackground") {
      try {
        chrome.runtime.sendMessage({"path": "content-to-background", "method": "checkTopFrame"}, function (resp) {
          if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError) {
            blockFrame();
            return;
          }
          if (!resp || !resp.enabled) {
            blockFrame();
            return;
          }
          applyResolved(resp.useragent);
        });
      } catch (err) {
        blockFrame();
      }
      return;
    }
    applyResolved(e && e.useragent);
  });
}
