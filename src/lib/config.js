var config = (function () {
  const normalizeUserAgent = function (val) {
    return typeof val === "string" ? val.replace(/[\r\n\t]+/g, " ").trim() : "";
  };
  const isValidUserAgent = function (val) {
    return !/[^\x20-\x7E]/.test(val);
  };
  /*  */
  return {
    /* base domains with mobile view turned on */
    get sites () {
      const val = app.storage.read("sites");
      return Array.isArray(val) ? val : [];
    },
    set sites (val) {
      config.setSites(val).catch(function () {});
    },
    "setSites": function (val) {
      return app.storage.write("sites", Array.isArray(val) ? val : []);
    },
    /*  */
    get bypassCache () {
      const val = app.storage.read("bypassCache");
      return val !== undefined ? Boolean(val) : true;
    },
    set bypassCache (val) {
      config.setBypassCache(val).catch(function () {});
    },
    "setBypassCache": function (val) {
      return app.storage.write("bypassCache", Boolean(val));
    },
    /* data/content_script/inject.js reads the same "useragent" key directly;
       an empty value drops the key so that the default applies again */
    get useragent () {
      const normalized = normalizeUserAgent(app.storage.read("useragent"));
      if (!normalized || !isValidUserAgent(normalized)) return defaults.useragent;
      return normalized;
    },
    set useragent (val) {
      config.setUseragent(val).catch(function () {});
    },
    "setUseragent": function (val) {
      const normalized = normalizeUserAgent(val);
      if (!normalized) {
        return app.storage.remove("useragent");
      }
      if (!isValidUserAgent(normalized)) {
        return Promise.reject(new Error("Invalid user-agent"));
      }
      return app.storage.write("useragent", normalized);
    },
    /* content scripts registered for the sites; "matches" is filled in at registration time */
    "scripts": [
      {
        "id": "mobview-storage",
        "allFrames": true,
        "runAt": "document_start",
        "matchOriginAsFallback": true,
        "js": ["lib/defaults.js", "data/content_script/inject.js"]
      },
      {
        "id": "mobview-script",
        "world": "MAIN",
        "allFrames": true,
        "runAt": "document_start",
        "matchOriginAsFallback": true,
        "js": ["data/content_script/page_context/inject.js"]
      }
    ]
  };
})();
