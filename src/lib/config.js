var config = {
  "testPage": "https://webbrowsertools.com/useragent/?verbose=false&delay=true&method=ug",
  /* base domains with mobile view turned on */
  get sites () {return app.storage.read("sites") !== undefined ? app.storage.read("sites") : []},
  set sites (val) {app.storage.write("sites", val)},
  /*  */
  get bypassCache () {return app.storage.read("bypassCache") !== undefined ? app.storage.read("bypassCache") : true},
  set bypassCache (val) {app.storage.write("bypassCache", val)},
  /* data/content_script/inject.js reads the same "useragent" key directly;
     an empty value drops the key so that the default applies again */
  get useragent () {return app.storage.read("useragent") || defaults.useragent},
  set useragent (val) {val ? app.storage.write("useragent", val) : app.storage.remove("useragent")},
  /* content scripts registered for the sites; "matches" is filled in at registration time */
  "scripts": [
    {
      "id": "mobview-storage",
      "allFrames": true,
      "runAt": "document_start",
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
