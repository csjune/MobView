// Loads the extension's classic scripts into a sandbox backed by an in-memory fake of
// the browser APIs they use, so their behaviour can be tested with plain Node.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = path.join(__dirname, "..", "src");
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));

function read(file) {
  return fs.readFileSync(path.join(SRC, file), "utf8");
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
    icons: {},
    menus: [],
    opened: [],
    reloads: [],
    toOptions: []
  };
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: event(),
      onInstalled: event(),
      onStartup: event(),
      /* messages are serialized between extension pages, so keep a copy */
      sendMessage(message) {state.toOptions.push(structuredClone(message))}
    },
    storage: {
      local: {
        get(keys, callback) {
          const copy = structuredClone(state.storage);
          setTimeout(() => callback(keys === null ? copy : (keys in copy ? {[keys]: copy[keys]} : {})));
        },
        set(items) {Object.assign(state.storage, structuredClone(items))},
        remove(key) {delete state.storage[key]}
      }
    },
    action: {
      onClicked: event(),
      setIcon({tabId, path}) {state.icons[tabId] = path[16].split("/")[3]}
    },
    contextMenus: {
      onClicked: event(),
      removeAll(callback) {state.menus = []; callback()},
      create(options) {
        if (state.menus.some((menu) => menu.id === options.id)) throw new Error("duplicate menu id");
        state.menus.push(options);
      }
    },
    scripting: {
      async registerContentScripts(scripts) {state.scripts = structuredClone(scripts)},
      async unregisterContentScripts() {state.scripts = []}
    },
    declarativeNetRequest: {
      async getDynamicRules() {return state.rules},
      async updateDynamicRules({removeRuleIds, addRules}) {
        const rules = state.rules.filter((rule) => !removeRuleIds.includes(rule.id)).concat(structuredClone(addRules));
        const ids = rules.map((rule) => rule.id);
        if (new Set(ids).size !== ids.length) throw new Error("duplicate rule ids");
        state.rules = rules;
      }
    },
    tabs: {
      onActivated: event(),
      onUpdated: event(),
      query(query, callback) {callback(query.active ? state.tabs.slice(0, 1) : state.tabs)},
      get(tabId, callback) {callback(state.tabs.find((tab) => tab.id === tabId))},
      create({url}) {state.opened.push(url)},
      reload(tabId, {bypassCache}) {state.reloads.push({tabId, bypassCache})}
    }
  };
  return {chrome, state};
}

/* runs the background scripts listed in the manifest */
function loadBackground(options) {
  const {chrome, state} = createChrome(options);
  const context = vm.createContext({chrome, console, URL, setTimeout, structuredClone});
  for (const file of manifest.background.scripts) {
    vm.runInContext(read(file), context, {filename: file});
  }
  return {chrome, state, context};
}

/* runs a registered content script entry against a fake page */
function runContentScript(script, {chrome, navigator = {}, localStorage}) {
  const context = vm.createContext({chrome, navigator, localStorage});
  for (const file of script.js) {
    vm.runInContext(read(file), context, {filename: file});
  }
  return context;
}

function fakeLocalStorage(initial = {}, {blocked = false} = {}) {
  const items = {...initial};
  return {
    items,
    getItem(key) {
      if (blocked) throw new Error("SecurityError");
      return key in items ? items[key] : null;
    },
    setItem(key, value) {
      if (blocked) throw new Error("SecurityError");
      items[key] = String(value);
    }
  };
}

/* lets queued promises and storage callbacks settle */
function settle(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {loadBackground, runContentScript, fakeLocalStorage, settle, read};
