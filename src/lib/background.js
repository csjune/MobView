var core = {
  "domains": {
    /* hosting platforms where every subdomain is a separate site */
    "shared": [
      'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'netlify.app', 'vercel.app',
      'web.app', 'firebaseapp.com', 'herokuapp.com', 'blogspot.com', 'tistory.com'
    ],
    /* generic second-level labels used under 2-letter country TLDs (co.uk, ac.jp, ...) */
    "second": ['co', 'com', 'org', 'net', 'edu', 'gov', 'mil', 'ac'],
    /* country-specific second-level labels keyed by 2-letter ccTLD */
    "countrySecond": {
      "jp": ["ad", "ed", "go", "gr", "lg", "ne", "or"],
      "kr": ["es", "go", "hs", "kg", "ms", "ne", "or", "pe", "re", "sc"],
      "id": ["go", "ne", "or", "sch", "web"],
      "th": ["go", "in", "mi", "or"],
      "at": ["gv", "or"],
      "ke": ["go", "ne", "or", "sc"],
      "tz": ["go", "ne", "or", "sc"],
      "ug": ["go", "ne", "or", "sc"],
      "nz": ["geek", "gen", "govt", "iwi", "kiwi", "maori", "ori", "school"],
      "uk": ["gov", "ltd", "me", "mod", "nhs", "nic", "plc", "police", "sch"],
      "au": ["asn", "csiro", "id"],
      "il": ["idf", "k12", "muni"]
    }
  },
  "normalizeHostname": function (hostname) {
    if (typeof hostname !== "string") return "";
    const trimmed = hostname.trim().toLowerCase().replace(/\.+$/, "");
    if (!trimmed) return "";
    if (trimmed[0] === "[") {
      try {
        const h = new URL("http://" + trimmed).hostname;
        return h[0] === "[" && h[h.length - 1] === "]" ? h : "";
      } catch (e) {
        return "";
      }
    }
    if (trimmed.indexOf("..") !== -1 || trimmed[0] === ".") return "";
    return trimmed;
  },
  "isIpv6": function (host) {
    return Boolean(host) && host.length > 2 && host[0] === "[" && host[host.length - 1] === "]";
  },
  "isIpv4": function (host) {
    if (typeof host !== "string" || !host) return false;
    const parts = host.split(".");
    return parts.length === 4 && parts.every(function (part) {
      return /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255;
    });
  },
  "isExactHost": function (site) {
    return Boolean(site) && (core.isIpv6(site) || core.isIpv4(site) || site.indexOf(".") === -1);
  },
  "matchesHost": function (hostname, site) {
    const host = core.normalizeHostname(hostname);
    if (!host || !site) return false;
    if (host === site) return true;
    return !core.isExactHost(site) && host.endsWith("." + site);
  },
  "getHostname": function (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return core.normalizeHostname(parsed.hostname);
    } catch (e) {
      return "";
    }
  },
  "urlMatchesSite": function (url, site) {
    return core.matchesHost(core.getHostname(url), site);
  },
  "findEnabledSite": function (url) {
    const host = core.getHostname(url);
    if (!host) return null;
    const sites = config.sites;
    for (let i = 0; i < sites.length; i++) {
      if (core.matchesHost(host, sites[i])) return sites[i];
    }
    return null;
  },
  "getBaseDomain": function (hostname) {
    const host = core.normalizeHostname(hostname);
    if (!host) return null;
    if (core.isExactHost(host)) return host;
    /*  */
    const parts = host.split(".");
    for (const suffix of core.domains.shared) {
      if (host.endsWith("." + suffix)) {
        return parts.slice(-(suffix.split(".").length + 1)).join(".");
      }
    }
    /*  */
    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];
    const extra = Object.prototype.hasOwnProperty.call(core.domains.countrySecond, tld)
      ? core.domains.countrySecond[tld]
      : null;
    if (parts.length >= 3 && tld.length === 2 && (core.domains.second.indexOf(sld) !== -1 || (extra && extra.indexOf(sld) !== -1))) {
      return parts.slice(-3).join(".");
    }
    /*  */
    return parts.slice(-2).join(".");
  },
  /* base domain of an http(s) URL, or null */
  "getSite": function (url) {
    return core.getBaseDomain(core.getHostname(url));
  },
  "isEnabled": function (url) {
    return core.findEnabledSite(url) !== null;
  },
  "normalizeUserAgent": function (val) {
    return typeof val === "string" ? val.replace(/[\r\n\t]+/g, " ").trim() : "";
  },
  "isValidUserAgent": function (val) {
    return val === "" || /^[\x20-\x7E]+$/.test(val);
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
        if (core.isExactHost(site)) {
          matches.push("*://" + site + "/*");
        } else {
          matches.push("*://" + site + "/*", "*://*." + site + "/*");
        }
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
  "matchingTabs": function (predicate) {
    return new Promise(function (resolve) {
      app.tab.all(function (tabs) {
        resolve(tabs.filter(function (tab) {
          return tab && tab.id !== undefined && predicate(tab);
        }));
      });
    });
  },
  "updateTabsStorage": async function (predicate, update) {
    const tabs = await core.matchingTabs(predicate);
    await Promise.all(tabs.map(function (tab) {
      return Promise.resolve(update(tab)).catch(function () {});
    }));
  },
  "clearSiteStorage": function (site) {
    return core.updateTabsStorage(
      function (tab) {return core.urlMatchesSite(tab.url, site)},
      function (tab) {return app.contentscripts.clearTabStorage(tab.id)}
    );
  },
  "setSiteStorage": function (site, ua) {
    return core.updateTabsStorage(
      function (tab) {return core.urlMatchesSite(tab.url, site)},
      function (tab) {return app.contentscripts.setTabStorage(tab.id, ua)}
    );
  },
  "syncEnabledTabStorage": function (ua) {
    return core.updateTabsStorage(
      function (tab) {return core.isEnabled(tab.url)},
      function (tab) {return app.contentscripts.setTabStorage(tab.id, ua)}
    );
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
          const raw = e && typeof e.useragent === "string" ? e.useragent : "";
          const normalized = core.normalizeUserAgent(raw);
          if (!core.isValidUserAgent(normalized)) {
            app.options.send("useragentInvalid", {"useragent": config.useragent});
            return;
          }
          const previous = app.storage.read("useragent") || "";
          config.useragent = normalized;
          try {
            await core.apply();
          } catch (err) {
            config.useragent = previous;
            await core.apply();
            app.options.send("useragentInvalid", {"useragent": config.useragent});
            return;
          }
          await core.syncEnabledTabStorage(config.useragent);
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
        const existingSite = core.findEnabledSite(tab.url);
        const site = existingSite || core.getSite(tab.url);
        if (!site) return;
        /*  */
        const sites = config.sites;
        const enabling = !existingSite;
        config.sites = enabling
          ? sites.filter(function (e) {return !core.matchesHost(e, site)}).concat(site)
          : sites.filter(function (e) {return e !== existingSite});
        await core.apply();
        if (enabling) {
          await core.setSiteStorage(site, config.useragent);
        } else {
          await core.clearSiteStorage(site);
        }
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
