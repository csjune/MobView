// Loads the extension's classic scripts into a sandbox backed by an in-memory fake of
// the browser APIs they use, so their behaviour can be tested with plain Node.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = path.join(__dirname, "..", "src");

function read(file, dir = SRC) {
  return fs.readFileSync(path.join(dir, file), "utf8");
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
      if (
        !sub ||
        sub.endsWith(".") ||
        sub.startsWith("[") ||
        /^\d{1,3}(\.\d{1,3}){3}$/.test(sub) ||
        sub.includes("..")
      ) {
        throw new Error(`Invalid match pattern: ${pattern}`);
      }
    } else if (host !== "*") {
      if (host.endsWith(".") || host.includes("..")) {
        throw new Error(`Invalid match pattern: ${pattern}`);
      }
      if (host.startsWith("[")) {
        try {
          if (new URL("http://" + host).hostname !== host) {
            throw new Error("Invalid IPv6 host");
          }
        } catch {
          throw new Error(`Invalid match pattern: ${pattern}`);
        }
      }
    }
  }
}

function validateDomainCondition(domain) {
  if (typeof domain !== "string" || domain.length === 0 || domain !== domain.toLowerCase() || domain.endsWith(".")) {
    throw new Error("Invalid domain condition");
  }
  if (domain.startsWith("[")) {
    try {
      if (new URL("http://" + domain).hostname !== domain) {
        throw new Error("Invalid IPv6 domain");
      }
    } catch {
      throw new Error("Invalid domain condition");
    }
  }
}

function event() {
  const listeners = [];
  return {
    addListener(fn) {listeners.push(fn)},
    fire(...args) {listeners.forEach((fn) => fn(...args))}
  };
}

function createChrome({tabs = [], storage = {}} = {}) {
  const state = {
    tabs,
    storage: {...storage},
    rules: [],
    scripts: [],
    scriptingCalls: [],
    executedScripts: [],
    icons: {},
    reloads: [],
    toOptions: [],
    storageGetError: null
  };
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
      /* messages are serialized between extension pages, so keep a copy */
      sendMessage(message, callback) {
        const copy = structuredClone(message);
        if (!copy || copy.path !== "options-to-background") {
          state.toOptions.push(copy);
        }
        setTimeout(() => {
          chrome.runtime.onMessage.fire(copy);
          if (typeof callback === "function") callback();
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
          setTimeout(() => {
            if (state.storageGetError) {
              chrome.runtime.lastError = state.storageGetError;
              callback(undefined);
              chrome.runtime.lastError = null;
              return;
            }
            const copy = structuredClone(state.storage);
            let result;
            if (keys === null || keys === undefined) {
              result = copy;
            } else if (Array.isArray(keys)) {
              result = {};
              for (const key of keys) {
                if (Object.hasOwn(copy, key)) result[key] = copy[key];
              }
            } else if (typeof keys === "string") {
              result = Object.hasOwn(copy, keys) ? {[keys]: copy[keys]} : {};
            } else if (typeof keys === "object") {
              result = {};
              for (const [key, fallback] of Object.entries(keys)) {
                result[key] = Object.hasOwn(copy, key) ? copy[key] : fallback;
              }
            } else {
              result = {};
            }
            callback(result);
          });
        },
        set(items, callback) {
          Object.assign(state.storage, structuredClone(items));
          if (typeof callback === "function") setTimeout(callback);
        },
        remove(keys, callback) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete state.storage[key];
          }
          if (typeof callback === "function") setTimeout(callback);
        }
      }
    },
    action: {
      onClicked: event(),
      setIcon({tabId, path}) {state.icons[tabId] = path[16].split("/")[3]}
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
          if (existing.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`);
          existing.add(script.id);
        }
        state.scripts.push(...structuredClone(scripts));
      },
      async updateContentScripts(scripts) {
        state.scriptingCalls.push("update");
        for (const script of scripts) {
          validateMatchPatterns(script.matches);
          if (!state.scripts.some((existing) => existing.id === script.id)) {
            throw new Error(`Nonexistent script ID '${script.id}'`);
          }
        }
        for (const script of structuredClone(scripts)) {
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
        if (typeof injection.func === "function") {
          try {
            return [{result: injection.func(...(injection.args || []))}];
          } catch {
            return [];
          }
        }
        return [];
      }
    },
    declarativeNetRequest: {
      async getDynamicRules() {return state.rules},
      async updateDynamicRules({removeRuleIds = [], addRules = []} = {}) {
        for (const rule of addRules) {
          if (rule && rule.action && rule.action.type === "modifyHeaders" && Array.isArray(rule.action.requestHeaders)) {
            for (const h of rule.action.requestHeaders) {
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
            for (const field of ["requestDomains", "initiatorDomains"]) {
              if (Array.isArray(rule.condition[field])) {
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
      query(query, callback) {callback(query && query.active ? state.tabs.slice(0, 1) : state.tabs)},
      get(tabId, callback) {callback(state.tabs.find((tab) => tab.id === tabId))},
      reload(tabId, {bypassCache}) {state.reloads.push({tabId, bypassCache})}
    }
  };
  return {chrome, state};
}

/* runs the background scripts listed in the manifest */
function loadBackground({tabs = [], storage = {}, dir = SRC, worker = false} = {}) {
  const {chrome, state} = createChrome({tabs, storage});
  const manifest = JSON.parse(read("manifest.json", dir));
  const context = vm.createContext({chrome, console, URL, setTimeout, structuredClone});
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
  return {chrome, state, context};
}

function createWindow({
  isSubframe = false,
  sameOriginTop = true,
  topHostname = null,
  ancestorOrigins = null,
  referrer = "",
  hostname = "naver.com"
} = {}) {
  const location = {
    hostname,
    href: "https://" + hostname + "/"
  };
  if (Array.isArray(ancestorOrigins)) {
    location.ancestorOrigins = [...ancestorOrigins];
  }
  const document = {referrer};

  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
      this._stopped = false;
    }
    stopImmediatePropagation() {
      this._stopped = true;
    }
    stopPropagation() {}
  }

  const listeners = {capture: new Map(), bubble: new Map()};
  const normalizeCapture = (options) => (typeof options === "boolean" ? options : Boolean(options && options.capture));
  const bucket = (type, options) => {
    const map = normalizeCapture(options) ? listeners.capture : listeners.bubble;
    if (!map.has(type)) map.set(type, []);
    return map.get(type);
  };

  const win = {
    location,
    document,
    CustomEvent,
    addEventListener(type, handler, capture = false) {
      if (typeof handler !== "function") return;
      const list = bucket(type, capture);
      if (!list.some((entry) => entry.handler === handler)) {
        list.push({handler, once: Boolean(capture && typeof capture === "object" && capture.once)});
      }
    },
    removeEventListener(type, handler, capture = false) {
      const list = bucket(type, capture);
      const index = list.findIndex((entry) => entry.handler === handler);
      if (index !== -1) list.splice(index, 1);
    },
    dispatchEvent(event) {
      for (const phase of [listeners.capture, listeners.bubble]) {
        const list = phase.get(event.type);
        if (!list) continue;
        for (const entry of [...list]) {
          if (event._stopped) break;
          if (entry.once) {
            const index = list.indexOf(entry);
            if (index !== -1) list.splice(index, 1);
          }
          entry.handler.call(win, event);
        }
        if (event._stopped) break;
      }
      return true;
    }
  };
  win.window = win;
  win.self = win;

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
          get hostname() {throw new Error("SecurityError")},
          get href() {throw new Error("SecurityError")}
        }
      };
    }
    win.top = top;
    win.parent = top;
  }

  return win;
}

/* runs a registered content script entry against a fake page */
function runContentScript(script, {chrome, navigator = {}, sessionStorage, localStorage, window, location, document, dir = SRC}) {
  const context = vm.createContext({
    chrome: script.world === "MAIN" ? undefined : chrome,
    navigator,
    sessionStorage,
    localStorage,
    window,
    location: location || (window && window.location),
    document: document || (window && window.document),
    CustomEvent: (window && window.CustomEvent) || undefined,
    URL,
    TypeError
  });
  for (const file of script.js) {
    vm.runInContext(read(file, dir), context, {filename: file});
  }
  return context;
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

/* lets queued promises and storage callbacks settle */
function settle(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  SRC,
  loadBackground,
  runContentScript,
  fakeStorage,
  fakeLocalStorage: fakeStorage,
  createWindow,
  settle,
  read
};
