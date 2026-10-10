{
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
      return localStorage.getItem("mobview-useragent");
    } catch (e) {
      return null;
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
    /*  */
    return {
      "userAgent": useragent,
      "appVersion": useragent.replace(/^Mozilla\//, ''),
      "platform": ios ? (/iPad/.test(useragent) ? "iPad" : "iPhone") : (android ? "Linux armv8l" : original.platform),
      "vendor": ios ? "Apple Computer, Inc." : (chrome ? "Google Inc." : original.vendor),
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
}
