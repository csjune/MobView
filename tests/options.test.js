const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const {loadBackground, read, settle} = require("./harness");

function createElement(tagName, id = "", ownerDocument = null) {
  const children = [];
  const attributes = {};
  const listeners = {};
  let text = "";

  const element = {
    tagName: tagName.toUpperCase(),
    id,
    className: "",
    type: "",
    value: "",
    checked: false,
    children,
    get textContent() {
      return children.length ? children.map((child) => child.textContent).join("") : text;
    },
    set textContent(next) {
      children.length = 0;
      text = next == null ? "" : String(next);
    },
    get ariaLabel() {
      return element.getAttribute("aria-label");
    },
    set ariaLabel(next) {
      element.setAttribute("aria-label", next);
    },
    setAttribute(name, val) {
      attributes[name] = String(val);
      if (name === "id") element.id = String(val);
      if (name === "class") element.className = String(val);
      if (name === "type") element.type = String(val);
    },
    getAttribute(name) {
      return Object.hasOwn(attributes, name) ? attributes[name] : null;
    },
    removeAttribute(name) {
      delete attributes[name];
    },
    append(...nodes) {
      for (const node of nodes) {
        if (node !== undefined && node !== null) children.push(node);
      }
    },
    appendChild(node) {
      children.push(node);
      return node;
    },
    addEventListener(eventName, handler) {
      if (!listeners[eventName]) listeners[eventName] = [];
      listeners[eventName].push(handler);
    },
    click() {
      for (const handler of listeners.click || []) {
        handler({type: "click", target: element, currentTarget: element, preventDefault() {}});
      }
    },
    change() {
      for (const handler of listeners.change || []) {
        handler({type: "change", target: element, currentTarget: element, preventDefault() {}});
      }
    },
    input() {
      for (const handler of listeners.input || []) {
        handler({type: "input", target: element, currentTarget: element, preventDefault() {}});
      }
    },
    focus() {
      if (ownerDocument) ownerDocument.activeElement = element;
      for (const handler of listeners.focus || []) {
        handler({type: "focus", target: element, currentTarget: element, preventDefault() {}});
      }
    },
    blur() {
      if (ownerDocument && ownerDocument.activeElement === element) {
        ownerDocument.activeElement = null;
      }
      for (const handler of listeners.blur || []) {
        handler({type: "blur", target: element, currentTarget: element, preventDefault() {}});
      }
    }
  };
  return element;
}

function createDocument() {
  const docListeners = {};
  const doc = {
    activeElement: null,
    visibilityState: "visible",
    elements: null,
    _listeners: docListeners,
    createElement(tagName) {
      return createElement(tagName, "", doc);
    },
    getElementById(id) {
      return Object.hasOwn(doc.elements, id) ? doc.elements[id] : null;
    },
    addEventListener(eventName, handler) {
      if (!docListeners[eventName]) docListeners[eventName] = [];
      docListeners[eventName].push(handler);
    },
    dispatch(eventName) {
      for (const handler of docListeners[eventName] || []) {
        handler({type: eventName, target: doc, currentTarget: doc, preventDefault() {}});
      }
    }
  };

  doc.elements = {
    useragent: createElement("textarea", "useragent", doc),
    sites: createElement("ul", "sites", doc),
    "bypass-cache": createElement("input", "bypass-cache", doc)
  };
  doc.elements["bypass-cache"].type = "checkbox";
  return doc;
}

function createOptionsWindow() {
  const winListeners = {};
  const win = {
    _listeners: winListeners,
    addEventListener(eventName, handler) {
      if (!winListeners[eventName]) winListeners[eventName] = [];
      winListeners[eventName].push(handler);
    },
    dispatch(eventName) {
      for (const handler of winListeners[eventName] || []) {
        handler({type: eventName, target: win, currentTarget: win, preventDefault() {}});
      }
    }
  };
  return win;
}

async function loadOptions(backgroundOptions) {
  const {chrome, state, context} = loadBackground(backgroundOptions);
  const document = createDocument();
  const window = createOptionsWindow();
  const optionsContext = vm.createContext({chrome, document, window, console, setTimeout, clearTimeout});
  vm.runInContext(read("data/options/options.js"), optionsContext, {filename: "data/options/options.js"});
  document.dispatch("DOMContentLoaded");
  await settle();
  return {chrome, state, context, document, window, optionsContext};
}

test("initial load populates bypass-cache, useragent, and empty sites message", async () => {
  const {context, document} = await loadOptions({});
  assert.equal(document.getElementById("bypass-cache").checked, true);
  assert.equal(document.getElementById("useragent").value, context.defaults.useragent);

  const items = document.getElementById("sites").children;
  assert.equal(items.length, 1);
  assert.equal(items[0].className, "empty");
  assert.ok(items[0].textContent.length > 0);
});

test("toggling sites via toolbar updates #sites live with site span and accessible Remove button", async () => {
  const tabs = [{id: 1, url: "https://m.naver.com/x"}];
  const {chrome, state, document} = await loadOptions({tabs});

  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();

  let items = document.getElementById("sites").children;
  assert.equal(items.length, 1);
  const [span, button] = items[0].children;
  assert.equal(span.tagName, "SPAN");
  assert.equal(span.textContent, "naver.com");
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.type, "button");
  assert.equal(button.textContent, "Remove");
  assert.equal(button.getAttribute("aria-label"), "Remove naver.com");

  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();

  items = document.getElementById("sites").children;
  assert.equal(items.length, 1);
  assert.equal(items[0].className, "empty");
});

test("clicking Remove deletes the site from storage and re-renders #sites", async () => {
  const {state, document} = await loadOptions({storage: {sites: ["naver.com", "daum.net"]}});
  let items = document.getElementById("sites").children;
  assert.equal(items.length, 2);

  items[0].children[1].click();
  await settle();

  assert.deepEqual(state.storage.sites, ["daum.net"]);
  assert.deepEqual(state.rules[0].condition.requestDomains, ["daum.net"]);
  items = document.getElementById("sites").children;
  assert.equal(items.length, 1);
  assert.equal(items[0].children[0].textContent, "daum.net");
  assert.equal(items[0].children[1].getAttribute("aria-label"), "Remove daum.net");

  items[0].children[1].click();
  await settle();

  assert.deepEqual(state.storage.sites, []);
  items = document.getElementById("sites").children;
  assert.equal(items.length, 1);
  assert.equal(items[0].className, "empty");
});

test("changing #bypass-cache and #useragent updates storage, rules, and resets whitespace useragent", async () => {
  const {state, context, document} = await loadOptions({storage: {sites: ["naver.com"]}});
  const bypassCacheEl = document.getElementById("bypass-cache");
  const useragentEl = document.getElementById("useragent");

  bypassCacheEl.checked = false;
  bypassCacheEl.change();
  await settle();
  assert.equal(state.storage.bypassCache, false);

  useragentEl.value = "Custom-UA/1.0";
  useragentEl.change();
  await settle();
  assert.equal(state.storage.useragent, "Custom-UA/1.0");
  assert.equal(state.rules[0].action.requestHeaders[0].value, "Custom-UA/1.0");

  useragentEl.value = "   \n\t  ";
  useragentEl.change();
  await settle();
  assert.equal("useragent" in state.storage, false);
  assert.equal(state.rules[0].action.requestHeaders[0].value, context.defaults.useragent);
  assert.equal(useragentEl.value, context.defaults.useragent);
});

test("focused typing in #useragent debounces save and preserves value while focused", async () => {
  const {state, document} = await loadOptions({storage: {sites: ["naver.com"]}});
  const useragentEl = document.getElementById("useragent");

  useragentEl.focus();
  useragentEl.value = "Mobile-UA ";
  useragentEl.input();
  await settle(350);

  assert.equal(state.storage.useragent, "Mobile-UA");
  assert.equal(state.rules[0].action.requestHeaders[0].value, "Mobile-UA");
  assert.equal(useragentEl.value, "Mobile-UA ");
});

test("switching away from options tab via visibilitychange immediately flushes unsaved input", async () => {
  const {state, document} = await loadOptions({storage: {sites: ["naver.com"]}});
  const useragentEl = document.getElementById("useragent");

  useragentEl.focus();
  useragentEl.value = "Flushed-On-Hide";
  useragentEl.input();

  document.visibilityState = "hidden";
  document.dispatch("visibilitychange");
  await settle();

  assert.equal(state.storage.useragent, "Flushed-On-Hide");
  assert.equal(state.rules[0].action.requestHeaders[0].value, "Flushed-On-Hide");
});

test("closing options tab via pagehide immediately flushes unsaved input", async () => {
  const {state, document, window} = await loadOptions({storage: {sites: ["naver.com"]}});
  const useragentEl = document.getElementById("useragent");

  useragentEl.focus();
  useragentEl.value = "Flushed-On-Pagehide";
  useragentEl.input();

  window.dispatch("pagehide");
  await settle();

  assert.equal(state.storage.useragent, "Flushed-On-Pagehide");
  assert.equal(state.rules[0].action.requestHeaders[0].value, "Flushed-On-Pagehide");
});

test("clearing #useragent during focused input keeps value before commit and resets on blur", async () => {
  const {state, context, document} = await loadOptions({
    storage: {sites: ["naver.com"], useragent: "Custom-UA"}
  });
  const useragentEl = document.getElementById("useragent");

  useragentEl.focus();
  useragentEl.value = "   ";
  useragentEl.input();
  await settle(350);
  assert.equal(useragentEl.value, "   ");
  assert.equal(state.storage.useragent, "Custom-UA");

  useragentEl.blur();
  await settle();
  assert.equal("useragent" in state.storage, false);
  assert.equal(state.rules[0].action.requestHeaders[0].value, context.defaults.useragent);
  assert.equal(useragentEl.value, context.defaults.useragent);
});
