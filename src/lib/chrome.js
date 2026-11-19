var app = {};

app.backgroundWorker = typeof importScripts === "function";

app.error = function () {
  return chrome.runtime.lastError;
};

app.storage = {
  "local": {},
  "read": function (id) {
    return app.storage.local[id];
  },
  "mutate": function (id, applyLocal, persist, fallbackError) {
    const hadPrev = Object.prototype.hasOwnProperty.call(app.storage.local, id);
    const prev = app.storage.local[id];
    applyLocal();
    return new Promise(function (resolve, reject) {
      persist(function () {
        if (chrome.runtime.lastError) {
          if (hadPrev) {
            app.storage.local[id] = prev;
          } else {
            delete app.storage.local[id];
          }
          reject(new Error(chrome.runtime.lastError.message || fallbackError));
          return;
        }
        resolve();
      });
    });
  },
  "write": function (id, data) {
    return app.storage.mutate(
      id,
      function () {app.storage.local[id] = data;},
      function (done) {chrome.storage.local.set({[id]: data}, done);},
      "Failed to save storage"
    );
  },
  "remove": function (id) {
    return app.storage.mutate(
      id,
      function () {delete app.storage.local[id];},
      function (done) {chrome.storage.local.remove(id, done);},
      "Failed to remove storage"
    );
  },
  /* the background is the only writer, so the in-memory copy is read from disk once per wake-up */
  "load": function (callback) {
    if (!app.storage.ready) {
      app.storage.ready = new Promise(function (resolve, reject) {
        chrome.storage.local.get(null, function (e) {
          if (chrome.runtime.lastError) {
            app.storage.ready = null;
            reject(new Error(chrome.runtime.lastError.message || "Failed to load storage"));
            return;
          }
          app.storage.local = e || {};
          resolve();
        });
      });
    }
    return app.storage.ready.then(callback).catch(function (e) {
      console.error(e);
    });
  },
  "ready": null,
  "session": (function () {
    const memory = {};
    const getNative = function () {
      return typeof chrome !== "undefined" && chrome.storage && chrome.storage.session;
    };
    const callNative = function (native, method, arg, fallbackValue) {
      return new Promise(function (resolve) {
        let settled = false;
        const finish = function (res) {
          if (settled) return;
          settled = true;
          resolve(res);
        };
        try {
          const maybePromise = native[method](arg, function (res) {
            if (chrome.runtime && chrome.runtime.lastError) {
              finish(fallbackValue);
              return;
            }
            finish(res);
          });
          if (maybePromise && typeof maybePromise.then === "function") {
            maybePromise.then(finish, function () {
              finish(fallbackValue);
            });
          }
        } catch (e) {
          finish(fallbackValue);
        }
      });
    };
    return {
      "get": async function (key) {
        const native = getNative();
        const store = native ? await callNative(native, "get", key, {}) : memory;
        if (typeof key === "string") {
          return store && Object.prototype.hasOwnProperty.call(store, key) ? store[key] : undefined;
        }
        if (Array.isArray(key)) {
          const out = {};
          key.forEach(function (k) {
            if (store && Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
          });
          return out;
        }
        return Object.assign({}, store);
      },
      "set": async function (items) {
        if (!items || typeof items !== "object") return;
        const native = getNative();
        if (!native) {
          Object.assign(memory, items);
          return;
        }
        await callNative(native, "set", items, undefined);
      }
    };
  })()
};

/* wraps an event callback so that it runs after the storage has been loaded */
app.loaded = function (callback) {
  return function () {
    const args = arguments;
    return app.storage.load(function () {
      return callback.apply(null, args);
    });
  };
};

app.on = {
  "installed": function (callback) {
    chrome.runtime.onInstalled.addListener(app.loaded(callback));
  },
  "startup": function (callback) {
    chrome.runtime.onStartup.addListener(app.loaded(callback));
  },
  "button": function (callback) {
    chrome.action.onClicked.addListener(app.loaded(callback));
  },
  "tabs": {
    "activated": function (callback) {
      chrome.tabs.onActivated.addListener(app.loaded(callback));
    },
    "updated": function (callback) {
      chrome.tabs.onUpdated.addListener(app.loaded(callback));
    },
    "replaced": function (callback) {
      if (chrome.tabs && chrome.tabs.onReplaced) {
        chrome.tabs.onReplaced.addListener(app.loaded(callback));
      }
    }
  }
};

app.options = {
  "message": {},
  "receive": function (id, callback) {
    app.options.message[id] = callback;
  },
  "send": function (id, data) {
    chrome.runtime.sendMessage({"data": data, "method": id, "path": "background-to-options"}, app.error);
  }
};

app.content = {
  "message": {},
  "receive": function (id, callback) {
    app.content.message[id] = callback;
  }
};

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (!request) return;
  const dispatch = function (table, args, mapResult, fallback) {
    let responded = false;
    const reply = function (payload) {
      if (!responded) {
        responded = true;
        if (typeof sendResponse === "function") sendResponse(payload);
      }
    };
    app.storage.load(function () {
      const handler = Object.prototype.hasOwnProperty.call(table, request.method) ? table[request.method] : null;
      if (typeof handler !== "function") {
        reply(fallback);
        return;
      }
      return Promise.resolve(handler.apply(null, args)).then(function (result) {
        reply(mapResult(result));
      });
    }).then(function () {
      reply(fallback);
    }, function () {
      reply(fallback);
    });
    return true;
  };
  if (request.path === "options-to-background") {
    return dispatch(app.options.message, [request.data], function (result) {
      return result && typeof result === "object" ? Object.assign({"ok": true}, result) : {"ok": true};
    }, {"ok": false});
  }
  if (request.path === "content-to-background") {
    return dispatch(app.content.message, [request.data, sender], function (result) {return result;}, null);
  }
});

app.button = {
  "icon": function (tabId, state) {
    const path = {};
    [16, 32, 48, 64, 128].forEach(function (size) {
      path[size] = "/data/icons/" + state + "/" + size + ".png";
    });
    chrome.action.setIcon({"tabId": tabId, "path": path}, app.error);
  }
};

app.contentscripts = {
  "get": function () {
    return chrome.scripting.getRegisteredContentScripts();
  },
  "register": function (scripts) {
    return chrome.scripting.registerContentScripts(scripts);
  },
  "update": function (scripts) {
    return chrome.scripting.updateContentScripts(scripts);
  },
  "unregister": function (ids) {
    return ids ? chrome.scripting.unregisterContentScripts({"ids": ids}) : chrome.scripting.unregisterContentScripts();
  },
  "clearTabStorage": function (tabId) {
    return chrome.scripting.executeScript({
      "target": {"tabId": tabId, "allFrames": true},
      "func": function () {
        try {sessionStorage.removeItem("mobview-useragent")} catch (e) {}
        try {localStorage.removeItem("mobview-useragent")} catch (e) {}
      }
    }).catch(function () {});
  },
  "setTabStorage": function (tabId, ua, sites) {
    return chrome.scripting.executeScript({
      "target": {"tabId": tabId, "allFrames": true},
      "args": [ua, Array.isArray(sites) ? sites : []],
      "func": function (value, allowedSites) {
        const normalize = function (v) {
          return typeof v === "string" ? v.trim().toLowerCase().replace(/\.+$/, "") : "";
        };
        const isExactHost = function (h) {
          return h.startsWith("[") || h.indexOf(".") === -1 || /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
        };
        const host = normalize(typeof location !== "undefined" && location ? location.hostname : "");
        if (!host || !Array.isArray(allowedSites)) return;
        const matched = allowedSites.some(function (entry) {
          const site = normalize(entry);
          if (!site) return false;
          if (isExactHost(host) || isExactHost(site)) return host === site;
          return host === site || host.endsWith("." + site);
        });
        if (!matched) return;
        try {sessionStorage.setItem("mobview-useragent", value)} catch (e) {}
        try {localStorage.removeItem("mobview-useragent")} catch (e) {}
      }
    }).catch(function () {});
  }
};

app.netrequest = {
  /* MobView is the only owner of dynamic rules, so every update swaps the whole set atomically */
  "replace": async function (rules) {
    const current = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      "removeRuleIds": current.map(function (e) {return e.id}),
      "addRules": rules.map(function (rule, index) {
        return {"id": index + 1, "priority": 1, "action": rule.action, "condition": rule.condition};
      })
    });
  }
};

app.tab = {
  "get": function (tabId, callback) {
    chrome.tabs.get(tabId, function (tab) {
      if (!chrome.runtime.lastError && tab) callback(tab);
    });
  },
  "all": function (callback) {
    chrome.tabs.query({}, function (tabs) {
      callback(!chrome.runtime.lastError && tabs ? tabs : []);
    });
  },
  "reload": function (tabId, bypassCache) {
    chrome.tabs.reload(tabId, {"bypassCache": !!bypassCache}, app.error);
  }
};
