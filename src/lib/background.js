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
      "nz": ["cri", "geek", "gen", "govt", "iwi", "kiwi", "maori", "school"],
      "uk": ["ltd", "me", "mod", "nhs", "nic", "plc", "police", "sch"],
      "au": ["asn", "csiro", "id"],
      "il": ["idf", "k12", "muni"]
    }
  },
  "normalizeHostname": function (hostname) {
    if (typeof hostname !== "string") return "";
    const trimmed = hostname.trim().toLowerCase().replace(/\.+$/, "");
    if (!trimmed) return "";
    if (trimmed[0] === "[") {
      if (trimmed[trimmed.length - 1] !== "]") return "";
      try {
        const h = new URL("http://" + trimmed).hostname;
        return h[0] === "[" && h[h.length - 1] === "]" ? h : "";
      } catch (e) {
        return "";
      }
    }
    if (trimmed.length > 253 || trimmed[0] === "." || trimmed.indexOf("..") !== -1) return "";
    const labels = trimmed.split(".");
    for (let i = 0; i < labels.length; i++) {
      if (!/^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(labels[i])) return "";
    }
    try {
      return new URL("http://" + trimmed).hostname === trimmed ? trimmed : "";
    } catch (e) {
      return "";
    }
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
    const target = core.normalizeHostname(site);
    if (!host || !target) return false;
    if (host === target) return true;
    return !core.isExactHost(host) && !core.isExactHost(target) && host.endsWith("." + target);
  },
  "sanitizeSites": function (sites) {
    if (!Array.isArray(sites)) return [];
    const normalized = [];
    const seen = new Set();
    for (let i = 0; i < sites.length; i++) {
      const host = core.normalizeHostname(sites[i]);
      if (host && !seen.has(host)) {
        seen.add(host);
        normalized.push(host);
      }
    }
    return normalized.filter(function (host) {
      if (core.isExactHost(host)) return true;
      let idx = host.indexOf(".");
      while (idx !== -1) {
        const parent = host.slice(idx + 1);
        if (!core.isExactHost(parent) && seen.has(parent)) return false;
        idx = host.indexOf(".", idx + 1);
      }
      return true;
    });
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
      if (core.matchesHost(host, sites[i])) return core.normalizeHostname(sites[i]);
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
  /* normalized hostname from user-entered host or http(s) URL, or "" */
  "parseSiteInput": function (raw) {
    if (typeof raw !== "string") return "";
    const trimmed = raw.trim();
    if (!trimmed || /\s/.test(trimmed)) return "";
    const parseHttpUrl = function (input) {
      try {
        const parsed = new URL(input);
        if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
          return "";
        }
        return core.normalizeHostname(parsed.hostname);
      } catch (e) {
        return "";
      }
    };
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return parseHttpUrl(trimmed);
    if (trimmed.startsWith("//")) return parseHttpUrl("http:" + trimmed);
    if (trimmed[0] === "[") return parseHttpUrl("http://" + trimmed);
    if (trimmed.indexOf("/") === -1 && (trimmed.match(/:/g) || []).length >= 2) {
      return parseHttpUrl("http://[" + trimmed + "]");
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\d{1,5}(?:[/?#]|$)/.test(trimmed)) {
      return "";
    }
    if (/^\d+$/.test(trimmed)) return "";
    return parseHttpUrl("http://" + trimmed);
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
  "extractTokenAfter": function (str, prefix) {
    const idx = str.indexOf(prefix);
    if (idx === -1) return "";
    const start = idx + prefix.length;
    let end = start;
    while (end < str.length) {
      const ch = str[end];
      if (ch === " " || ch === ";" || ch === ")") break;
      end += 1;
    }
    return str.slice(start, end);
  },
  "majorOf": function (ver) {
    if (!ver) return "";
    let end = 0;
    while (end < ver.length) {
      const ch = ver[end];
      if (ch < "0" || ch > "9") break;
      end += 1;
    }
    return ver.slice(0, end);
  },
  "parseChromiumHints": function (ua) {
    if (typeof ua !== "string") return null;
    if (ua.indexOf("Chrome/") === -1 && ua.indexOf("Chromium/") === -1) return null;
    const chromeToken = core.extractTokenAfter(ua, "Chrome/");
    const chromiumToken = core.extractTokenAfter(ua, "Chromium/");
    const chromeFull = chromeToken || chromiumToken || "157.0.0.0";
    const chromeMajor = core.majorOf(chromeFull) || "157";
    /*  */
    const edgeFull = core.extractTokenAfter(ua, "EdgA/") || core.extractTokenAfter(ua, "Edg/");
    const oprFull = core.extractTokenAfter(ua, "OPR/");
    const samsungFull = core.extractTokenAfter(ua, "SamsungBrowser/");
    const isWebView = ua.indexOf("; wv)") !== -1 || ua.indexOf("; wv;") !== -1;
    /*  */
    let brandName = null;
    let brandFull = "";
    if (ua.indexOf("EdgA/") !== -1 || ua.indexOf("Edg/") !== -1) {
      brandName = "Microsoft Edge";
      brandFull = edgeFull || chromeFull;
    } else if (ua.indexOf("OPR/") !== -1) {
      brandName = "Opera";
      brandFull = oprFull || chromeFull;
    } else if (ua.indexOf("SamsungBrowser/") !== -1) {
      brandName = "Samsung Internet";
      brandFull = samsungFull || chromeFull;
    } else if (isWebView) {
      brandName = "Android WebView";
      brandFull = chromeFull;
    } else if (ua.indexOf("Chrome/") !== -1) {
      brandName = "Google Chrome";
      brandFull = chromeFull;
    }
    const brandMajor = brandFull ? (core.majorOf(brandFull) || chromeMajor) : null;
    const brands = [
      {"brand": "Not/A)Brand", "version": "8"},
      {"brand": "Chromium", "version": chromeMajor}
    ];
    if (brandName) {
      brands.push({"brand": brandName, "version": brandMajor});
    }
    const secChUa = brands.map(function (b) {
      return '"' + b.brand + '";v="' + b.version + '"';
    }).join(", ");
    const mobile = ua.indexOf("Mobile") !== -1 || ua.indexOf("iPhone") !== -1 || ua.indexOf("iPod") !== -1 ? "?1" : "?0";
    const ios = ua.indexOf("iPad") !== -1 || ua.indexOf("iPod") !== -1 || ua.indexOf("iPhone") !== -1;
    const platformName = ua.indexOf("Android") !== -1 ? "Android"
      : (ios ? "iOS"
      : (ua.indexOf("Windows") !== -1 ? "Windows"
      : (ua.indexOf("Macintosh") !== -1 ? "macOS"
      : (ua.indexOf("CrOS") !== -1 ? "Chrome OS"
      : (ua.indexOf("Linux") !== -1 ? "Linux" : "Android")))));
    return {
      "brands": brands,
      "secChUa": secChUa,
      "mobile": mobile,
      "platform": '"' + platformName + '"'
    };
  },
  "lowEntropyHints": ["ua", "ua-mobile", "ua-platform"],
  "highEntropyHints": [
    "ua-arch", "ua-bitness", "ua-form-factors", "ua-full-version",
    "ua-full-version-list", "ua-model", "ua-platform-version", "ua-wow64"
  ],
  "buildRuleSet": function (sites, action, extraCondition) {
    const withExtra = function (cond) {
      return extraCondition ? Object.assign({}, extraCondition, cond) : cond;
    };
    return [
      {
        /* top-level documents of the sites */
        "action": action,
        "condition": withExtra({
          "requestDomains": sites,
          "resourceTypes": ["main_frame"]
        })
      },
      {
        /* sub_frames of the sites only when initiated by an enabled site, so an enabled
           site embedded in a desktop page stays desktop, matching its JS userAgent */
        "action": action,
        "condition": withExtra({
          "requestDomains": sites,
          "initiatorDomains": sites,
          "resourceTypes": ["sub_frame"]
        })
      },
      {
        /* subresources initiated by the sites' pages (frame types excluded).
           Note: DNR has no topFrameDomains condition, so subresources initiated by an
           enabled-origin iframe embedded inside a desktop top page still match initiatorDomains. */
        "action": action,
        "condition": withExtra({
          "initiatorDomains": sites,
          "excludedResourceTypes": ["main_frame", "sub_frame"]
        })
      }
    ];
  },
  "queue": Promise.resolve(),
  "serial": function (task) {
    core.queue = core.queue.then(task).catch(function (e) {console.error(e)});
    return core.queue;
  },
  "synced": false,
  "syncing": null,
  "sync": async function () {
    const rawSites = app.storage.read("sites");
    const cleaned = core.sanitizeSites(rawSites);
    const changed = !Array.isArray(rawSites) ||
      rawSites.length !== cleaned.length ||
      cleaned.some(function (site, i) {return rawSites[i] !== site});
    if (changed && rawSites !== undefined) {
      await config.setSites(cleaned);
    }
    await core.apply();
    core.synced = true;
    await app.storage.session.set({"mobviewSynced": true});
  },
  "ensureSynced": function () {
    if (core.synced || !config.sites.length) return Promise.resolve();
    if (!core.syncing) {
      core.syncing = (async function () {
        try {
          const sess = await app.storage.session.get("mobviewSynced");
          const existingScripts = sess ? await app.contentscripts.get() : [];
          if (!sess || existingScripts.length === 0) {
            await core.load();
          } else {
            core.synced = true;
          }
        } finally {
          core.syncing = null;
        }
      })();
    }
    return core.syncing;
  },
  "load": function () {
    return core.serial(core.sync);
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
      const ua = config.useragent;
      const uaHeader = {"operation": "set", "header": "user-agent", "value": ua};
      if (!app.backgroundWorker) {
        await app.netrequest.replace(core.buildRuleSet(sites, {
          "type": "modifyHeaders",
          "requestHeaders": [uaHeader]
        }));
        return;
      }
      /*  */
      const removeHeaders = function (list) {
        return list.map(function (hint) {
          return {"operation": "remove", "header": "sec-ch-" + hint};
        });
      };
      // Chromium can send its real desktop identity in addition to the User-Agent header.
      const removeAllAction = {
        "type": "modifyHeaders",
        "requestHeaders": [uaHeader].concat(removeHeaders(core.lowEntropyHints.concat(core.highEntropyHints)))
      };
      const hints = core.parseChromiumHints(ua);
      if (!hints) {
        await app.netrequest.replace(core.buildRuleSet(sites, removeAllAction));
        return;
      }
      /*  */
      const httpsAction = {
        "type": "modifyHeaders",
        "requestHeaders": [
          uaHeader,
          {"operation": "set", "header": "sec-ch-ua", "value": hints.secChUa},
          {"operation": "set", "header": "sec-ch-ua-mobile", "value": hints.mobile},
          {"operation": "set", "header": "sec-ch-ua-platform", "value": hints.platform}
        ].concat(removeHeaders(core.highEntropyHints))
      };
      const rules = core.buildRuleSet(sites, httpsAction, {"urlFilter": "|https://"})
        .concat(core.buildRuleSet(sites, removeAllAction, {"urlFilter": "|http://"}));
      await app.netrequest.replace(rules);
    }
  },
  /* push the current settings to scripts, rules, toolbar icons and the options page */
  "apply": async function () {
    await core.register.scripts();
    await core.register.netrequest();
    core.action.tabs.refreshAll();
    app.options.send("sites", config.sites);
  },
  "commitSites": async function (nextRawSites) {
    const previousSites = config.sites.slice();
    const nextSites = core.sanitizeSites(nextRawSites);
    try {
      await config.setSites(nextSites);
    } catch (err) {
      return false;
    }
    try {
      await core.apply();
      return true;
    } catch (err) {
      await config.setSites(previousSites).catch(function () {});
      try {await core.apply();} catch (re) {}
      return false;
    }
  },
  "optionsMeta": function (source) {
    return source && typeof source.clientId === "string" && source.clientId
      ? {"clientId": source.clientId, "requestId": source.requestId}
      : null;
  },
  "sendOptions": function (meta) {
    app.options.send("settings", Object.assign({
      "bypassCache": config.bypassCache,
      "useragent": config.useragent
    }, core.optionsMeta(meta)));
    app.options.send("sites", config.sites);
  },
  "storageSyncTimeout": 500,
  "withTimeout": function (promise, ms) {
    let timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise(function (resolve) {
        timer = setTimeout(resolve, ms);
      })
    ]).finally(function () {
      if (typeof clearTimeout === "function") clearTimeout(timer);
    });
  },
  "matchingTabs": function (predicate) {
    return new Promise(function (resolve) {
      app.tab.all(function (tabs) {
        resolve(tabs.filter(function (tab) {
          return tab && tab.id !== undefined && !tab.discarded && predicate(tab);
        }));
      });
    });
  },
  "updateTabsStorage": async function (predicate, update) {
    const tabs = await core.matchingTabs(predicate);
    await Promise.all(tabs.map(function (tab) {
      return core.withTimeout(
        Promise.resolve().then(function () {return update(tab);}).catch(function () {}),
        core.storageSyncTimeout
      );
    }));
  },
  "clearSiteStorage": function (siteOrSites) {
    const sites = Array.isArray(siteOrSites) ? siteOrSites : [siteOrSites];
    return core.updateTabsStorage(
      function (tab) {
        return !core.isEnabled(tab.url) && sites.some(function (s) {return core.urlMatchesSite(tab.url, s)});
      },
      function (tab) {return app.contentscripts.clearTabStorage(tab.id)}
    );
  },
  "setSiteStorage": function (site, ua) {
    const sites = config.sites;
    return core.updateTabsStorage(
      function (tab) {return core.urlMatchesSite(tab.url, site)},
      function (tab) {return app.contentscripts.setTabStorage(tab.id, ua, sites)}
    );
  },
  "syncEnabledTabStorage": function (ua) {
    const sites = config.sites;
    return core.updateTabsStorage(
      function (tab) {return core.isEnabled(tab.url)},
      function (tab) {return app.contentscripts.setTabStorage(tab.id, ua, sites)}
    );
  },
  "action": {
    "content": {
      "checkTopFrame": function (_data, sender) {
        const tabUrl = sender && sender.tab && sender.tab.url;
        const enabled = Boolean(tabUrl && core.isEnabled(tabUrl));
        return {"enabled": enabled, "useragent": enabled ? config.useragent : ""};
      }
    },
    "options": {
      "load": async function () {
        await core.ensureSynced();
        return core.serial(function () {return core.sendOptions();});
      },
      "bypassCache": function (e) {
        return core.serial(async function () {
          if (!e || typeof e.bypassCache !== "boolean") return;
          await config.setBypassCache(e.bypassCache);
        });
      },
      "useragent": function (e) {
        return core.serial(async function () {
          const meta = core.optionsMeta(e);
          const sendInvalid = function (reason) {
            app.options.send("useragentInvalid", Object.assign({
              "useragent": config.useragent,
              "reason": reason
            }, meta));
          };
          const raw = e && typeof e.useragent === "string" ? e.useragent : "";
          const normalized = core.normalizeUserAgent(raw);
          if (!core.isValidUserAgent(normalized)) {
            sendInvalid("ascii");
            return;
          }
          const prevNorm = core.normalizeUserAgent(app.storage.read("useragent"));
          const previous = prevNorm && core.isValidUserAgent(prevNorm) ? prevNorm : "";
          try {
            await config.setUseragent(normalized);
            await core.register.netrequest();
            if (config.sites.length) {
              const existing = await app.contentscripts.get();
              if (existing.length < config.scripts.length) await core.register.scripts();
            }
          } catch (err) {
            await config.setUseragent(previous).catch(function () {});
            try {await core.register.netrequest();} catch (re) {}
            sendInvalid("apply");
            return;
          }
          await core.syncEnabledTabStorage(config.useragent);
          core.sendOptions(meta);
        });
      },
      "addSite": function (e) {
        return core.serial(async function () {
          const site = core.parseSiteInput(e && e.site);
          if (!site) return {"ok": false, "reason": "invalid"};
          const sites = config.sites;
          if (sites.some(function (s) {return core.normalizeHostname(s) === site;})) {
            return {"ok": false, "reason": "duplicate", "site": site};
          }
          const covering = sites.find(function (s) {return core.matchesHost(site, s);});
          if (covering) {
            return {"ok": false, "reason": "covered", "site": site, "by": core.normalizeHostname(covering)};
          }
          const nextSites = sites.filter(function (s) {return !core.matchesHost(s, site);}).concat(site);
          if (!(await core.commitSites(nextSites))) return {"ok": false, "reason": "apply"};
          await core.setSiteStorage(site, config.useragent);
          return {"ok": true, "site": site};
        });
      },
      "removeSite": function (e) {
        return core.serial(async function () {
          const target = e ? core.normalizeHostname(e.site) : "";
          if (!target) return;
          const sites = config.sites;
          const nextSites = sites.filter(function (site) {
            return core.normalizeHostname(site) !== target;
          });
          if (nextSites.length === sites.length) return;
          if (await core.commitSites(nextSites)) {
            await core.clearSiteStorage(target);
          }
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
        if (activeInfo && activeInfo.tabId !== undefined) {
          app.tab.get(activeInfo.tabId, core.action.tabs.updateIcon);
        }
        return core.ensureSynced().catch(function (e) {console.error(e);});
      },
      "updated": function (tabId, changeInfo, tab) {
        if (changeInfo && (changeInfo.url || changeInfo.status)) {
          core.action.tabs.updateIcon(tab);
          return core.ensureSynced().catch(function (e) {console.error(e);});
        }
      },
      "replaced": function (addedTabId) {
        if (addedTabId !== undefined) {
          app.tab.get(addedTabId, core.action.tabs.updateIcon);
        }
        return core.ensureSynced().catch(function (e) {console.error(e);});
      }
    },
    "button": function (tab) {
      return core.serial(async function () {
        if (!tab || tab.id === undefined) return;
        const host = core.getHostname(tab.url);
        if (!host) return;
        /*  */
        const existingSite = core.findEnabledSite(tab.url);
        const site = existingSite || core.getBaseDomain(host);
        if (!site) return;
        /*  */
        const sites = config.sites;
        const enabling = !existingSite;
        const removedSites = enabling ? [] : sites.filter(function (e) {return core.matchesHost(host, e)});
        const nextSites = enabling
          ? sites.filter(function (e) {return !core.matchesHost(e, site)}).concat(site)
          : sites.filter(function (e) {return !core.matchesHost(host, e)});
        if (!(await core.commitSites(nextSites))) return;
        if (enabling) {
          await core.setSiteStorage(site, config.useragent);
        } else {
          await core.clearSiteStorage(removedSites);
        }
        app.tab.reload(tab.id, config.bypassCache);
      });
    }
  }
};

app.options.receive("load", core.action.options.load);
app.options.receive("bypassCache", core.action.options.bypassCache);
app.options.receive("useragent", core.action.options.useragent);
app.options.receive("addSite", core.action.options.addSite);
app.options.receive("removeSite", core.action.options.removeSite);
app.content.receive("checkTopFrame", core.action.content.checkTopFrame);

app.on.button(core.action.button);
app.on.tabs.activated(core.action.tabs.activated);
app.on.tabs.updated(core.action.tabs.updated);
app.on.tabs.replaced(core.action.tabs.replaced);
app.on.startup(core.load);
app.on.installed(core.load);
