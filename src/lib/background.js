var core = {
  "domains": {
    /* hosting platforms where every subdomain is a separate site */
    "shared": [
      'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'netlify.app', 'vercel.app',
      'web.app', 'firebaseapp.com', 'herokuapp.com', 'blogspot.com', 'tistory.com'
    ],
    /* second-level labels used under 2-letter country TLDs (co.uk, or.kr, lg.jp, ...) */
    "second": [
      'co', 'com', 'org', 'net', 'edu', 'gov', 'mil', 'ac', 'ne', 'go',
      'or', 'pe', 're', 'hs', 'ms', 'es', 'sc', 'kg',
      'ad', 'ed', 'gr', 'lg'
    ]
  },
  "getBaseDomain": function (hostname) {
    if (!hostname) return null;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return hostname;
    if (hostname.indexOf('.') === -1) return hostname;
    /*  */
    const parts = hostname.split('.');
    for (const suffix of core.domains.shared) {
      if (hostname.endsWith('.' + suffix)) {
        return parts.slice(-(suffix.split('.').length + 1)).join('.');
      }
    }
    /*  */
    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];
    if (parts.length >= 3 && tld.length === 2 && core.domains.second.indexOf(sld) !== -1) {
      return parts.slice(-3).join('.');
    }
    /*  */
    return parts.slice(-2).join('.');
  },
  /* base domain of an http(s) URL, or null */
  "getSite": function (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return core.getBaseDomain(parsed.hostname);
    } catch (e) {
      return null;
    }
  },
  "isEnabled": function (url) {
    const site = core.getSite(url);
    return !!site && config.sites.indexOf(site) !== -1;
  },
  "queue": Promise.resolve(),
  "serial": function (task) {
    core.queue = core.queue.then(task).catch(function (e) {console.error(e)});
    return core.queue;
  },
  "load": function () {
    core.serial(core.register.netrequest);
    app.contextmenu.create({
      "contexts": ["action"],
      "id": "mobview",
      "title": "What is my UserAgent?"
    });
  },
  "register": {
    "scripts": async function () {
      await app.contentscripts.unregister();
      /*  */
      const sites = config.sites;
      if (!sites.length) return;
      /*  */
      const matches = [];
      sites.forEach(function (site) {
        matches.push("*://" + site + "/*", "*://*." + site + "/*");
      });
      await app.contentscripts.register(config.scripts.map(function (script) {
        return Object.assign({}, script, {"matches": matches});
      }));
    },
    "netrequest": async function () {
      const sites = config.sites;
      if (!sites.length) {
        await app.netrequest.replace([]);
        return;
      }
      /*  */
      const action = {
        "type": "modifyHeaders",
        "requestHeaders": [{"operation": "set", "header": "user-agent", "value": config.useragent}]
      };
      /*  */
      await app.netrequest.replace([
        {
          /* documents (main_frame, sub_frame) of the sites */
          "action": action,
          "condition": {
            "requestDomains": sites,
            "resourceTypes": ["main_frame", "sub_frame"]
          }
        },
        {
          /* subresources initiated by the sites' pages (sub_frame excluded so that
             third-party iframes stay desktop, matching their JS userAgent) */
          "action": action,
          "condition": {
            "initiatorDomains": sites,
            "resourceTypes": [
              "ping", "other", "websocket", "csp_report", "xmlhttprequest",
              "script", "image", "stylesheet", "font", "media", "object"
            ]
          }
        }
      ]);
    }
  },
  /* push the current settings to scripts, rules, toolbar icons and the options page */
  "apply": async function () {
    await core.register.scripts();
    await core.register.netrequest();
    core.action.tabs.refreshAll();
    app.options.send("sites", config.sites);
  },
  "action": {
    "test": function () {
      app.tab.open(config.testPage);
    },
    "options": {
      "load": function () {
        app.options.send("settings", {
          "bypassCache": config.bypassCache,
          "useragent": config.useragent
        });
        app.options.send("sites", config.sites);
      },
      "bypassCache": function (e) {
        config.bypassCache = e.bypassCache;
      },
      "useragent": function (e) {
        return core.serial(async function () {
          config.useragent = (e.useragent || "").trim();
          await core.apply();
          core.action.options.load();
        });
      },
      "removeSite": function (e) {
        return core.serial(async function () {
          if (!e || config.sites.indexOf(e.site) === -1) return;
          config.sites = config.sites.filter(function (site) {return site !== e.site});
          await core.apply();
        });
      }
    },
    "tabs": {
      "updateIcon": function (tab) {
        if (tab && tab.id !== undefined) {
          app.button.icon(tab.id, core.isEnabled(tab.url) ? "ON" : "OFF");
        }
      },
      "refreshAll": function () {
        app.tab.all(function (tabs) {
          tabs.forEach(core.action.tabs.updateIcon);
        });
      },
      "activated": function (activeInfo) {
        app.tab.get(activeInfo.tabId, core.action.tabs.updateIcon);
      },
      "updated": function (tabId, changeInfo, tab) {
        if (changeInfo.url || changeInfo.status) {
          core.action.tabs.updateIcon(tab);
        }
      }
    },
    "button": function () {
      return core.serial(async function () {
        const tab = await new Promise(app.tab.active);
        if (!tab || !tab.id) return;
        /*  */
        const site = core.getSite(tab.url);
        if (!site) return;
        /*  */
        const sites = config.sites;
        config.sites = sites.indexOf(site) === -1 ? sites.concat(site) : sites.filter(function (e) {return e !== site});
        await core.apply();
        app.tab.reload(tab.id, config.bypassCache);
      });
    }
  }
};

app.options.receive("load", core.action.options.load);
app.options.receive("bypassCache", core.action.options.bypassCache);
app.options.receive("useragent", core.action.options.useragent);
app.options.receive("removeSite", core.action.options.removeSite);
app.options.receive("test", core.action.test);

app.on.button(core.action.button);
app.on.contextmenu(core.action.test);
app.on.tabs.activated(core.action.tabs.activated);
app.on.tabs.updated(core.action.tabs.updated);
app.on.startup(core.load);
app.on.installed(core.load);

/* the background is an event page: re-register the content scripts every time it wakes up */
app.storage.load(function () {
  core.serial(core.register.scripts);
});
