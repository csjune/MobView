var config = {
  /* base domains with mobile view turned on */
  get sites () {return app.storage.read("sites") !== undefined ? app.storage.read("sites") : []},
  set sites (val) {app.storage.write("sites", val)},
  /*  */
  get bypassCache () {return app.storage.read("bypassCache") !== undefined ? app.storage.read("bypassCache") : true},
  set bypassCache (val) {app.storage.write("bypassCache", val)},
  /* data/content_script/inject.js reads the same "useragent" key directly;
     an empty value drops the key so that the default applies again */
  get useragent () {
    const val = app.storage.read("useragent");
    if (typeof val !== "string") return defaults.useragent;
    const normalized = val.replace(/[\r\n\t]+/g, " ").trim();
    if (!normalized || /[^\x20-\x7E]/.test(normalized)) return defaults.useragent;
    return normalized;
  },
  set useragent (val) {
    const normalized = typeof val === "string" ? val.replace(/[\r\n\t]+/g, " ").trim() : "";
    if (!normalized) {
      app.storage.remove("useragent");
    } else if (!/[^\x20-\x7E]/.test(normalized)) {
      app.storage.write("useragent", normalized);
    }
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
