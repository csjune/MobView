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
    core.serial(core.apply);
  },
  "register": {
    "scripts": async function () {
      const existing = await app.contentscripts.get();
      const existingIds = new Set(existing.map(function (script) {return script.id}));
      /*  */
      const sites = config.sites;
      if (!sites.length) {
        if (existingIds.size) await app.contentscripts.unregister(Array.from(existingIds));
        return;
      }
      /*  */
      const matches = [];
      sites.forEach(function (site) {
        matches.push("*://" + site + "/*", "*://*." + site + "/*");
      });
      const desired = config.scripts.map(function (script) {
        return Object.assign({}, script, {"matches": matches});
      });
      /*  */
      const toUpdate = [];
      const toRegister = [];
      desired.forEach(function (script) {
        if (existingIds.delete(script.id)) {
          toUpdate.push(script);
        } else {
          toRegister.push(script);
        }
      });
      /*  */
      if (existingIds.size) await app.contentscripts.unregister(Array.from(existingIds));
      if (toUpdate.length) await app.contentscripts.update(toUpdate);
      if (toRegister.length) await app.contentscripts.register(toRegister);
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
      if (app.backgroundWorker) {
        // Chromium can send its real desktop identity in addition to the User-Agent header.
        for (const hint of [
          "ua", "ua-mobile", "ua-platform", "ua-arch", "ua-bitness", "ua-form-factors",
          "ua-full-version", "ua-full-version-list", "ua-model", "ua-platform-version", "ua-wow64"
        ]) {
          action.requestHeaders.push({"operation": "remove", "header": "sec-ch-" + hint});
        }
      }
      /*  */
      await app.netrequest.replace([
        {
          /* top-level documents of the sites */
          "action": action,
          "condition": {
            "requestDomains": sites,
            "resourceTypes": ["main_frame"]
          }
        },
        {
          /* sub_frames of the sites only when initiated by an enabled site, so an enabled
             site embedded in a desktop page stays desktop, matching its JS userAgent */
          "action": action,
          "condition": {
            "requestDomains": sites,
            "initiatorDomains": sites,
            "resourceTypes": ["sub_frame"]
          }
        },
        {
          /* subresources initiated by the sites' pages (frame types excluded) */
          "action": action,
          "condition": {
            "initiatorDomains": sites,
            "excludedResourceTypes": ["main_frame", "sub_frame"]
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
  "clearSiteStorage": function (site) {
    return new Promise(function (resolve) {
      app.tab.all(function (tabs) {
        const clears = tabs.filter(function (tab) {
          return tab && tab.id !== undefined && core.getSite(tab.url) === site;
        }).map(function (tab) {
          return app.contentscripts.clearTabStorage(tab.id);
        });
        Promise.all(clears).then(resolve, resolve);
      });
    });
  },
  "action": {
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
          await core.clearSiteStorage(e.site);
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
    "button": function (tab) {
      return core.serial(async function () {
        if (!tab || tab.id === undefined) return;
        /*  */
        const site = core.getSite(tab.url);
        if (!site) return;
        /*  */
        const sites = config.sites;
        const enabling = sites.indexOf(site) === -1;
        config.sites = enabling ? sites.concat(site) : sites.filter(function (e) {return e !== site});
        await core.apply();
        if (!enabling) await core.clearSiteStorage(site);
        app.tab.reload(tab.id, config.bypassCache);
      });
    }
  }
};

app.options.receive("load", core.action.options.load);
app.options.receive("bypassCache", core.action.options.bypassCache);
app.options.receive("useragent", core.action.options.useragent);
app.options.receive("removeSite", core.action.options.removeSite);

app.on.button(core.action.button);
app.on.tabs.activated(core.action.tabs.activated);
app.on.tabs.updated(core.action.tabs.updated);
app.on.startup(core.load);
app.on.installed(core.load);
