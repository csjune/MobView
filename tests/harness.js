// Loads the extension's classic scripts into a sandbox backed by an in-memory fake of
// the browser APIs they use, so their behaviour can be tested with plain Node.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = path.join(__dirname, "..", "src");

function read(file, dir = SRC) {
  return fs.readFileSync(path.join(dir, file), "utf8");
}

function validateHostLabels(host, allowExactSingle) {
  if (!host || host.length > 253 || host.startsWith(".") || host.endsWith(".") || host.includes("..")) {
    return false;
  }
  if (/[^\x20-\x7E]/.test(host) || /[\s*:]/.test(host)) return false;
  if (!allowExactSingle && host.indexOf(".") === -1) return false;
  const labels = host.split(".");
  if (!labels.every((label) => /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(label))) {
    return false;
  }
  try {
    return new URL("http://" + host).hostname === host;
  } catch {
    return false;
  }
}

function validateMatchPatterns(matches) {
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new Error("Invalid match patterns");
  }
  for (const pattern of matches) {
    const m = /^(\*|https?):\/\/([^/]+)\/.*$/.exec(pattern);
    if (!m) throw new Error(`Invalid match pattern: ${pattern}`);
    const host = m[2];
    if (host.startsWith("*.")) {
      const sub = host.slice(2);
      if (sub.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(sub) || !validateHostLabels(sub, true)) {
        throw new Error(`Invalid match pattern: ${pattern}`);
      }
    } else if (host !== "*") {
      if (host.startsWith("[")) {
        if (!host.endsWith("]")) throw new Error(`Invalid match pattern: ${pattern}`);
        try {
          if (new URL("http://" + host).hostname !== host) {
            throw new Error("Invalid IPv6 host");
          }
        } catch {
          throw new Error(`Invalid match pattern: ${pattern}`);
        }
      } else if (!validateHostLabels(host, true)) {
        throw new Error(`Invalid match pattern: ${pattern}`);
      }
    }
  }
}

function validateDomainCondition(domain) {
  if (
    typeof domain !== "string" ||
    domain.length === 0 ||
    domain !== domain.toLowerCase() ||
    /[^\x20-\x7E]/.test(domain)
  ) {
    throw new Error("Invalid domain condition");
  }
  if (domain.startsWith("[")) {
    if (!domain.endsWith("]")) throw new Error("Invalid domain condition");
    try {
      if (new URL("http://" + domain).hostname !== domain) {
        throw new Error("Invalid IPv6 domain");
      }
    } catch {
      throw new Error("Invalid domain condition");
    }
  } else if (!validateHostLabels(domain, true)) {
    throw new Error("Invalid domain condition");
  }
}

function event() {
  const listeners = [];
  return {
    addListener(fn) {listeners.push(fn);},
    fire(...args) {return listeners.map((fn) => fn(...args));}
  };
}

function resolveKeys(copy, keys) {
  if (keys === null || keys === undefined) return copy;
  if (Array.isArray(keys)) {
    const result = {};
    for (const key of keys) {
      if (Object.hasOwn(copy, key)) result[key] = copy[key];
    }
    return result;
  }
  if (typeof keys === "string") {
    return Object.hasOwn(copy, keys) ? {[keys]: copy[keys]} : {};
  }
  if (typeof keys === "object") {
    const result = {};
    for (const [key, fallback] of Object.entries(keys)) {
      result[key] = Object.hasOwn(copy, key) ? copy[key] : fallback;
    }
    return result;
  }
  return {};
}

function fakeStorage(initial = {}, {blocked = false} = {}) {
  const items = {...initial};
  const check = () => {
    if (blocked) throw new Error("SecurityError");
  };
  return {
    items,
    getItem(key) {
      check();
      return Object.hasOwn(items, key) ? items[key] : null;
    },
    setItem(key, value) {
      check();
      items[key] = String(value);
    },
    removeItem(key) {
      check();
      delete items[key];
    },
    clear() {
      check();
      for (const key of Object.keys(items)) delete items[key];
    }
  };
}

function hostnameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname : "";
  } catch {
    return "";
  }
}

function cloneTab(tab) {
  if (!tab || typeof tab !== "object") return tab;
  const copy = {};
  for (const [key, value] of Object.entries(tab)) {
    if (key === "sessionStorage" || key === "localStorage" || key === "frames" || key === "hangExecute") continue;
    if (typeof value === "function") continue;
    copy[key] = structuredClone(value);
  }
  return copy;
}

function createChrome({
  tabs = [],
  storage = {},
  sessionStorageData = {},
  rules = [],
  scripts = [],
  dir = SRC,
  sharedState = null
} = {}) {
  const state = sharedState
    ? Object.assign(sharedState, {
      tabs,
      scriptingCalls: [],
      executedScripts: [],
      icons: {},
      reloads: [],
      toOptions: [],
      storageGetError: null,
      storageWriteError: null,
      storageRemoveError: null
    })
    : {
      tabs,
      storage: structuredClone(storage),
      sessionStorage: structuredClone(sessionStorageData),
      rules: structuredClone(rules),
      scripts: structuredClone(scripts),
      scriptingCalls: [],
      executedScripts: [],
      icons: {},
      reloads: [],
      toOptions: [],
      storageGetError: null,
      storageWriteError: null,
      storageRemoveError: null
    };

  const chrome = {
    runtime: {
      lastError: null,
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
      /* messages are serialized between extension pages, so keep a copy */
      sendMessage(message, optionsOrCallback, maybeCallback, sender = {}) {
        let callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
        const copy = structuredClone(message);
        if (!copy || (copy.path !== "options-to-background" && copy.path !== "content-to-background")) {
          state.toOptions.push(copy);
        }
        return new Promise((resolve) => {
          setTimeout(() => {
            let asyncHandled = false;
            let replied = false;
            const finish = (response) => {
              if (replied) return;
              replied = true;
              const cloned = response === undefined ? undefined : structuredClone(response);
              if (typeof callback === "function") callback(cloned);
              resolve(cloned);
            };
            for (const res of chrome.runtime.onMessage.fire(copy, structuredClone(sender), finish)) {
              if (res === true) asyncHandled = true;
            }
            if (!asyncHandled) finish(undefined);
          });
        });
      }
    },
    storage: {
      local: {
        get(keys, callback) {
          if (typeof keys === "function") {
            callback = keys;
            keys = null;
          }
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              if (state.storageGetError) {
                chrome.runtime.lastError = state.storageGetError;
                if (typeof callback === "function") callback(undefined);
                chrome.runtime.lastError = null;
                if (typeof callback !== "function") reject(new Error(state.storageGetError.message || "storage error"));
                return;
              }
              const result = resolveKeys(structuredClone(state.storage), keys);
              if (typeof callback === "function") callback(result);
              resolve(result);
            });
          });
        },
        set(items, callback) {
          const copy = structuredClone(items);
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              if (state.storageWriteError) {
                chrome.runtime.lastError = state.storageWriteError;
                if (typeof callback === "function") callback();
                chrome.runtime.lastError = null;
                if (typeof callback !== "function") reject(new Error(state.storageWriteError.message || "write error"));
                return;
              }
              Object.assign(state.storage, copy);
              if (typeof callback === "function") callback();
              resolve();
            });
          });
        },
        remove(keys, callback) {
          const list = Array.isArray(keys) ? [...keys] : [keys];
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              if (state.storageRemoveError) {
                chrome.runtime.lastError = state.storageRemoveError;
                if (typeof callback === "function") callback();
                chrome.runtime.lastError = null;
                if (typeof callback !== "function") reject(new Error(state.storageRemoveError.message || "remove error"));
                return;
              }
              for (const key of list) {
                delete state.storage[key];
              }
              if (typeof callback === "function") callback();
              resolve();
            });
          });
        }
      },
      session: {
        get(keys, callback) {
          if (typeof keys === "function") {
            callback = keys;
            keys = null;
          }
          return new Promise((resolve) => {
            setTimeout(() => {
              const result = resolveKeys(structuredClone(state.sessionStorage), keys);
              if (typeof callback === "function") callback(result);
              resolve(result);
            });
          });
        },
        set(items, callback) {
          const copy = structuredClone(items);
          return new Promise((resolve) => {
            setTimeout(() => {
              Object.assign(state.sessionStorage, copy);
              if (typeof callback === "function") callback();
              resolve();
            });
          });
        }
      }
    },
    action: {
      onClicked: event(),
      setIcon({tabId, path: iconPath}, callback) {
        const iconUrl = typeof iconPath === "string" ? iconPath : (iconPath[16] || Object.values(iconPath)[0]);
        state.icons[tabId] = iconUrl.split("/")[3];
        if (typeof callback === "function") setTimeout(callback);
      }
    },
    scripting: {
      async getRegisteredContentScripts(filter) {
        state.scriptingCalls.push("get");
        if (filter && Array.isArray(filter.ids)) {
          return structuredClone(state.scripts.filter((script) => filter.ids.includes(script.id)));
        }
        return structuredClone(state.scripts);
      },
      async registerContentScripts(scripts) {
        state.scriptingCalls.push("register");
        const existing = new Set(state.scripts.map((script) => script.id));
        for (const script of scripts) {
          validateMatchPatterns(script.matches);
          if (script.runAt && !["document_start", "document_end", "document_idle"].includes(script.runAt)) {
            throw new Error(`Invalid runAt: ${script.runAt}`);
          }
          if (script.world && !["ISOLATED", "MAIN"].includes(script.world)) {
            throw new Error(`Invalid world: ${script.world}`);
          }
          if (Array.isArray(script.js)) {
            for (const file of script.js) {
              if (!fs.existsSync(path.join(dir, file))) {
                throw new Error(`Missing script file: ${file}`);
              }
            }
          }
          if (existing.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`);
          existing.add(script.id);
        }
        state.scripts.push(...structuredClone(scripts));
      },
      async updateContentScripts(scripts) {
        state.scriptingCalls.push("update");
        const updated = [];
        for (const script of scripts) {
          const existing = state.scripts.find((item) => item.id === script.id);
          if (!existing) throw new Error(`Nonexistent script ID '${script.id}'`);
          const merged = Object.assign(structuredClone(existing), structuredClone(script));
          validateMatchPatterns(merged.matches);
          updated.push(merged);
        }
        for (const script of updated) {
          const index = state.scripts.findIndex((existing) => existing.id === script.id);
          state.scripts[index] = script;
        }
      },
      async unregisterContentScripts(filter) {
        state.scriptingCalls.push("unregister");
        if (filter && Array.isArray(filter.ids)) {
          state.scripts = state.scripts.filter((script) => !filter.ids.includes(script.id));
        } else {
          state.scripts = [];
        }
      },
      async executeScript(injection) {
        state.scriptingCalls.push("execute");
        const entry = {
          target: structuredClone(injection.target),
          hasFunc: typeof injection.func === "function"
        };
        if (injection.args !== undefined) {
          entry.args = structuredClone(injection.args);
        }
        state.executedScripts.push(entry);

        const tab = state.tabs.find((t) => t.id === (injection.target && injection.target.tabId));
        if (tab && tab.hangExecute) {
          return new Promise(() => {});
        }
        if (tab && (tab.discarded || (tab.url && /^(?:about|chrome|moz-extension|chrome-extension):/i.test(tab.url)))) {
          throw new Error("Cannot access contents of page");
        }
        if (typeof injection.func !== "function") return [];

        const frames = tab && Array.isArray(tab.frames) && tab.frames.length
          ? (injection.target && injection.target.allFrames ? tab.frames : [tab.frames[0]])
          : (() => {
            if (tab && !tab.sessionStorage) tab.sessionStorage = fakeStorage();
            if (tab && !tab.localStorage) tab.localStorage = fakeStorage();
            return [{
              hostname: tab && tab.url ? hostnameFromUrl(tab.url) : "",
              sessionStorage: tab ? tab.sessionStorage : fakeStorage(),
              localStorage: tab ? tab.localStorage : fakeStorage()
            }];
          })();

        const funcSrc = injection.func.toString();
        const serializedArgs = structuredClone(injection.args || []);
        const results = [];
        for (const frame of frames) {
          const frameCtx = vm.createContext({
            location: {hostname: frame.hostname || ""},
            sessionStorage: frame.sessionStorage,
            localStorage: frame.localStorage
          });
          frameCtx.__args = structuredClone(serializedArgs);
          try {
            const res = vm.runInContext(`(${funcSrc})(...__args)`, frameCtx);
            results.push({result: res === undefined ? null : structuredClone(res)});
          } catch {
            // Frame error ignored per frame just like storage-restricted frames
          }
        }
        return results;
      }
    },
    declarativeNetRequest: {
      async getDynamicRules() {return structuredClone(state.rules);},
      async updateDynamicRules({removeRuleIds = [], addRules = []} = {}) {
        const validResourceTypes = new Set([
          "main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object",
          "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport",
          "webbundle", "other"
        ]);
        for (const rule of addRules) {
          if (!Number.isInteger(rule.id) || rule.id < 1) throw new Error("Invalid rule id");
          if (rule.priority !== undefined && (!Number.isInteger(rule.priority) || rule.priority < 1)) {
            throw new Error("Invalid rule priority");
          }
          if (rule && rule.action && rule.action.type === "modifyHeaders" && Array.isArray(rule.action.requestHeaders)) {
            for (const h of rule.action.requestHeaders) {
              if (h && h.operation === "remove" && "value" in h) {
                throw new Error("Removed header cannot have a value");
              }
              if (h && h.operation === "set") {
                if (
                  typeof h.value !== "string" ||
                  h.value.length === 0 ||
                  /[^\x20-\x7E]/.test(h.value) ||
                  h.value !== h.value.trim()
                ) {
                  throw new Error("Invalid header value");
                }
              }
            }
          }
          if (rule && rule.condition) {
            if (rule.condition.resourceTypes && rule.condition.excludedResourceTypes) {
              throw new Error("Cannot specify both resourceTypes and excludedResourceTypes");
            }
            for (const listName of ["resourceTypes", "excludedResourceTypes"]) {
              if (rule.condition[listName] !== undefined) {
                if (!Array.isArray(rule.condition[listName]) || !rule.condition[listName].every((t) => validResourceTypes.has(t))) {
                  throw new Error(`Invalid ${listName}`);
                }
              }
            }
            for (const field of ["requestDomains", "initiatorDomains", "excludedRequestDomains", "excludedInitiatorDomains"]) {
              if (rule.condition[field] !== undefined) {
                if (!Array.isArray(rule.condition[field]) || rule.condition[field].length === 0) {
                  throw new Error(`Empty ${field}`);
                }
                for (const d of rule.condition[field]) {
                  validateDomainCondition(d);
                }
              }
            }
          }
        }
        const rules = state.rules.filter((rule) => !removeRuleIds.includes(rule.id)).concat(structuredClone(addRules));
        const ids = rules.map((rule) => rule.id);
        if (new Set(ids).size !== ids.length) throw new Error("duplicate rule ids");
        state.rules = rules;
      }
    },
    tabs: {
      onActivated: event(),
      onUpdated: event(),
      onReplaced: event(),
      query(query, callback) {
        const result = query && query.active ? state.tabs.slice(0, 1) : state.tabs;
        setTimeout(() => callback(result.map(cloneTab)));
      },
      get(tabId, callback) {
        setTimeout(() => {
          const found = state.tabs.find((tab) => tab.id === tabId);
          if (!found) {
            chrome.runtime.lastError = {message: `No tab with id: ${tabId}.`};
            callback(undefined);
            chrome.runtime.lastError = null;
            return;
          }
          callback(cloneTab(found));
        });
      },
      reload(tabId, {bypassCache}, callback) {
        state.reloads.push({tabId, bypassCache});
        if (typeof callback === "function") setTimeout(callback);
      }
    }
  };
  return {chrome, state};
}

function runBackgroundContext({chrome, dir = SRC, worker = false} = {}) {
  const manifest = JSON.parse(read("manifest.json", dir));
  const context = vm.createContext({
    chrome,
    console,
    URL,
    setTimeout,
    clearTimeout,
    structuredClone
  });
  if (worker || manifest.background.service_worker) {
    context.importScripts = (...files) => {
      for (const file of files) {
        vm.runInContext(read(file, dir), context, {filename: file});
      }
    };
    if (manifest.background.service_worker) {
      vm.runInContext(read(manifest.background.service_worker, dir), context, {filename: manifest.background.service_worker});
    } else {
      context.importScripts(...manifest.background.scripts);
    }
  } else {
    for (const file of manifest.background.scripts) {
      vm.runInContext(read(file, dir), context, {filename: file});
    }
  }
  return context;
}

/* runs the background scripts listed in the manifest */
function loadBackground({tabs = [], storage = {}, sessionStorageData = {}, dir = SRC, worker = false} = {}) {
  const {chrome, state} = createChrome({tabs, storage, sessionStorageData, dir});
  const context = runBackgroundContext({chrome, dir, worker});
  return {chrome, state, context};
}

/* simulates MV3 worker/event-page restart while preserving disk, session, scripts, and DNR rules */
function reloadBackground(prevState, {tabs = prevState.tabs, dir = SRC, worker = false} = {}) {
  const {chrome, state} = createChrome({tabs, dir, sharedState: prevState});
  const context = runBackgroundContext({chrome, dir, worker});
  return {chrome, state, context};
}

function createWindow({
  isSubframe = false,
  sameOriginTop = true,
  topHostname = null,
  ancestorOrigins = null,
  referrer = "",
  hostname = "naver.com",
  isSecureContext = true
} = {}) {
  const location = {
    hostname,
    href: "https://" + hostname + "/"
  };
  if (Array.isArray(ancestorOrigins)) {
    location.ancestorOrigins = [...ancestorOrigins];
  }
  const document = {referrer};

  class Event {
    constructor(type, init = {}) {
      this.type = type;
      this.cancelable = Boolean(init.cancelable);
      this.defaultPrevented = false;
      this._stopped = false;
    }
    stopImmediatePropagation() {
      this._stopped = true;
    }
    stopPropagation() {}
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true;
    }
  }

  class CustomEvent extends Event {
    constructor(type, init = {}) {
      super(type, init);
      this._detail = init.detail;
    }
    get detail() {
      return this._detail;
    }
  }

  const listenersByType = new Map();
  const isCaptureOpt = (options) => (typeof options === "boolean" ? options : Boolean(options && options.capture));
  const bucket = (type) => {
    if (!listenersByType.has(type)) listenersByType.set(type, []);
    return listenersByType.get(type);
  };

  const win = {
    location,
    document,
    Event,
    CustomEvent,
    addEventListener(type, handler, capture = false) {
      if (typeof handler !== "function") return;
      const cap = isCaptureOpt(capture);
      const list = bucket(type);
      if (!list.some((entry) => entry.handler === handler && entry.capture === cap)) {
        list.push({handler, capture: cap, once: Boolean(capture && typeof capture === "object" && capture.once)});
      }
    },
    removeEventListener(type, handler, capture = false) {
      const cap = isCaptureOpt(capture);
      const list = bucket(type);
      const index = list.findIndex((entry) => entry.handler === handler && entry.capture === cap);
      if (index !== -1) list.splice(index, 1);
    },
    dispatchEvent(evt) {
      const list = listenersByType.get(evt.type);
      if (list) {
        /* Window is the event target (AT_TARGET): invoke listeners in registration order regardless of capture */
        for (const entry of [...list]) {
          if (evt._stopped) break;
          if (entry.once) {
            const index = list.indexOf(entry);
            if (index !== -1) list.splice(index, 1);
          }
          entry.handler.call(win, evt);
        }
      }
      return !evt.defaultPrevented;
    }
  };
  win.window = win;
  win.self = win;
  win.isSecureContext = isSecureContext;

  if (!isSubframe) {
    win.top = win;
    win.parent = win;
  } else {
    let top;
    if (sameOriginTop) {
      const resolvedTop = topHostname || hostname;
      top = {
        location: {
          hostname: resolvedTop,
          href: "https://" + resolvedTop + "/"
        }
      };
    } else {
      top = {
        location: {
          get hostname() {throw new Error("SecurityError");},
          get href() {throw new Error("SecurityError");}
        }
      };
    }
    win.top = top;
    win.parent = top;
  }

  return win;
}

function createWebIDLNavigator({
  userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
  appVersion = "5.0 (Windows)",
  platform = "Win32",
  vendor = "",
  maxTouchPoints = 0,
  oscpu,
  userAgentData
} = {}) {
  const navInstances = new WeakSet();
  const uaDataInstances = new WeakSet();
  const uaDataProps = new WeakMap();

  function Navigator() {throw new TypeError("Illegal constructor");}
  function NavigatorUAData() {throw new TypeError("Illegal constructor");}

  const values = {userAgent, appVersion, platform, vendor, maxTouchPoints};
  for (const key of Object.keys(values)) {
    Object.defineProperty(Navigator.prototype, key, {
      configurable: true,
      enumerable: true,
      get() {
        if (!navInstances.has(this)) throw new TypeError("Illegal invocation");
        return values[key];
      }
    });
  }
  if (oscpu !== undefined) {
    Object.defineProperty(Navigator.prototype, "oscpu", {
      configurable: true,
      enumerable: true,
      get() {
        if (!navInstances.has(this)) throw new TypeError("Illegal invocation");
        return oscpu;
      }
    });
  }

  let uaDataInstance;
  if (userAgentData !== undefined) {
    Object.defineProperty(NavigatorUAData.prototype, Symbol.toStringTag, {
      value: "NavigatorUAData",
      configurable: true
    });
    for (const key of ["brands", "mobile", "platform"]) {
      Object.defineProperty(NavigatorUAData.prototype, key, {
        configurable: true,
        enumerable: true,
        get() {
          if (!uaDataInstances.has(this)) throw new TypeError("Illegal invocation");
          return uaDataProps.get(this)[key];
        }
      });
    }
    Object.defineProperty(NavigatorUAData.prototype, "toJSON", {
      configurable: true,
      enumerable: true,
      writable: true,
      value() {
        if (!uaDataInstances.has(this)) throw new TypeError("Illegal invocation");
        const d = uaDataProps.get(this);
        return {brands: d.brands, mobile: d.mobile, platform: d.platform};
      }
    });
    Object.defineProperty(NavigatorUAData.prototype, "getHighEntropyValues", {
      configurable: true,
      enumerable: true,
      writable: true,
      async value(hints) {
        if (!uaDataInstances.has(this)) throw new TypeError("Illegal invocation");
        if (!Array.isArray(hints)) throw new TypeError("Invalid sequence");
        const d = uaDataProps.get(this);
        const out = {brands: d.brands, mobile: d.mobile, platform: d.platform};
        for (const h of hints) {
          if (h in d) out[h] = d[h];
        }
        return out;
      }
    });

    uaDataInstance = Object.create(NavigatorUAData.prototype);
    uaDataInstances.add(uaDataInstance);
    uaDataProps.set(uaDataInstance, {
      brands: userAgentData.brands || [],
      mobile: Boolean(userAgentData.mobile),
      platform: userAgentData.platform || "Windows",
      architecture: userAgentData.architecture || "x86",
      bitness: userAgentData.bitness || "64",
      model: userAgentData.model || "",
      platformVersion: userAgentData.platformVersion || "15.0.0",
      uaFullVersion: userAgentData.uaFullVersion || "157.0.0.0",
      fullVersionList: userAgentData.fullVersionList || userAgentData.brands || [],
      wow64: Boolean(userAgentData.wow64),
      formFactors: userAgentData.formFactors || ["Desktop"]
    });

    Object.defineProperty(Navigator.prototype, "userAgentData", {
      configurable: true,
      enumerable: true,
      get() {
        if (!navInstances.has(this)) throw new TypeError("Illegal invocation");
        return uaDataInstance;
      }
    });
  }

  const navigator = Object.create(Navigator.prototype);
  navInstances.add(navigator);
  return {
    navigator,
    Navigator,
    NavigatorUAData: userAgentData !== undefined ? NavigatorUAData : undefined
  };
}

function makeContentChrome(baseChrome, sender = {}) {
  if (!baseChrome) return baseChrome;
  return {
    storage: baseChrome.storage,
    runtime: {
      get lastError() {return baseChrome.runtime.lastError;},
      sendMessage(message, optionsOrCallback, maybeCallback) {
        const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
        return baseChrome.runtime.sendMessage(message, undefined, callback, sender);
      }
    }
  };
}

/* runs a registered content script entry against a fake page */
function runContentScript(script, {
  chrome,
  navigator = {},
  Navigator,
  NavigatorUAData,
  sessionStorage,
  localStorage,
  window,
  location,
  document,
  sender,
  dir = SRC
}) {
  if (window && typeof window === "object") {
    window.navigator = navigator;
    window.sessionStorage = sessionStorage;
    window.localStorage = localStorage;
  }
  const contentChrome = script.world === "MAIN" ? undefined : (sender ? makeContentChrome(chrome, sender) : chrome);
  const contextGlobals = {
    chrome: contentChrome,
    navigator,
    sessionStorage,
    localStorage,
    window,
    isSecureContext: window && typeof window.isSecureContext === "boolean" ? window.isSecureContext : true,
    location: location || (window && window.location),
    document: document || (window && window.document),
    Event: (window && window.Event) || undefined,
    CustomEvent: (window && window.CustomEvent) || undefined,
    URL
  };
  if (Navigator !== undefined) contextGlobals.Navigator = Navigator;
  if (NavigatorUAData !== undefined) contextGlobals.NavigatorUAData = NavigatorUAData;
  const context = vm.createContext(contextGlobals);
  for (const file of script.js) {
    vm.runInContext(read(file, dir), context, {filename: file});
  }
  return context;
}

/* lets queued promises and storage callbacks settle */
function settle(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  SRC,
  createChrome,
  loadBackground,
  reloadBackground,
  runContentScript,
  fakeStorage,
  fakeLocalStorage: fakeStorage,
  createWindow,
  createWebIDLNavigator,
  settle,
  read
};
