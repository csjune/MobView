{
  const fallback = typeof mobviewDefaultUserAgent === "string" ? mobviewDefaultUserAgent : null;
  const original = {
    "userAgent": navigator.userAgent,
    "appVersion": navigator.appVersion,
    "platform": navigator.platform,
    "vendor": navigator.vendor,
    "maxTouchPoints": navigator.maxTouchPoints
  };
  /*  */
  const read = function () {
    try {
      return localStorage.getItem("mobview-useragent") || fallback;
    } catch (e) {
      return fallback;
    }
  };
  /* navigator values that have to agree with the spoofed user-agent */
  const spoof = function () {
    const useragent = read();
    if (!useragent) return original;
    /*  */
    const ios = /iPhone|iPad|iPod/.test(useragent);
    const android = /Android/.test(useragent);
    const chrome = /Chrome\//.test(useragent);
    const firefox = !chrome && /Firefox\//.test(useragent);
    /*  */
    return {
      "userAgent": useragent,
      /* Firefox reports only the first token of the platform part, e.g. "5.0 (Android 14)" */
      "appVersion": firefox ? "5.0 (" + (/\(([^;)]+)/.exec(useragent) || ["", ""])[1] + ")" : useragent.replace(/^Mozilla\//, ''),
      "platform": ios ? (/iPad/.test(useragent) ? "iPad" : "iPhone") : (android ? "Linux armv8l" : original.platform),
      "vendor": ios ? "Apple Computer, Inc." : (chrome ? "Google Inc." : (firefox ? "" : original.vendor)),
      "maxTouchPoints": ios || android ? 5 : original.maxTouchPoints
    };
  };
  /*  */
  Object.keys(original).forEach(function (key) {
    Object.defineProperty(navigator, key, {
      "configurable": true,
      "get": function () {
        return spoof()[key];
      }
    });
  });
  if (fallback && "userAgentData" in navigator) {
    Object.defineProperty(navigator, "userAgentData", {"configurable": true, "value": undefined});
  }
}
