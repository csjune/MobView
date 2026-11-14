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
  "write": function (id, data) {
    app.storage.local[id] = data;
    chrome.storage.local.set({[id]: data}, app.error);
  },
  "remove": function (id) {
    delete app.storage.local[id];
    chrome.storage.local.remove(id, app.error);
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
    return app.storage.ready.then(callback, function (e) {
      console.error(e);
    });
  },
  "ready": null
};

/* wraps an event callback so that it runs after the storage has been loaded */
app.loaded = function (callback) {
  return function () {
    const args = arguments;
    app.storage.load(function () {
      callback.apply(null, args);
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

chrome.runtime.onMessage.addListener(function (request) {
  if (request && request.path === "options-to-background") {
    app.storage.load(function () {
      const handler = app.options.message[request.method];
      if (typeof handler === "function") handler(request.data);
    });
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
