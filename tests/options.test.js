const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const {loadBackground, read, settle} = require("./harness");

function createElement(tagName, id = "", ownerDocument = null) {
  const children = [];
  const attributes = {};
  const dataset = {};
  const listeners = {};
  let text = "";
  if (id === "useragent-error") attributes.hidden = "";

  const element = {
    tagName: tagName.toUpperCase(),
    id,
    className: "",
    type: "",
    value: "",
    checked: false,
    dataset,
    children,
    get hidden() {
      return Object.hasOwn(attributes, "hidden");
    },
    set hidden(val) {
      if (val) {
        attributes.hidden = "";
      } else {
        delete attributes.hidden;
      }
    },
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
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        dataset[key] = String(val);
      }
    },
    getAttribute(name) {
      return Object.hasOwn(attributes, name) ? attributes[name] : null;
    },
    hasAttribute(name) {
      return Object.hasOwn(attributes, name);
    },
    removeAttribute(name) {
      delete attributes[name];
      if (name.startsWith("data-")) {
        const key = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        delete dataset[key];
      }
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
    dispatch(eventName, init = {}) {
      const event = {
        type: eventName,
        target: element,
        currentTarget: element,
        defaultPrevented: false,
        preventDefault() {
          event.defaultPrevented = true;
        },
        ...init
      };
      for (const handler of listeners[eventName] || []) {
        handler(event);
      }
      return event;
    },
    keydown({key = "Enter", shiftKey = false, isComposing = false, keyCode = 0} = {}) {
      return element.dispatch("keydown", {key, shiftKey, isComposing, keyCode});
    },
    click() {
      return element.dispatch("click");
    },
    change() {
      return element.dispatch("change");
    },
    input() {
      return element.dispatch("input");
    },
    focus() {
      if (ownerDocument) ownerDocument.activeElement = element;
      return element.dispatch("focus");
    },
    blur() {
      if (ownerDocument && ownerDocument.activeElement === element) {
        ownerDocument.activeElement = null;
      }
      return element.dispatch("blur");
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
    "useragent-error": createElement("p", "useragent-error", doc),
    sites: createElement("ul", "sites", doc),
    "bypass-cache": createElement("input", "bypass-cache", doc),
    "status-announcer": createElement("div", "status-announcer", doc)
  };
  doc.elements["bypass-cache"].type = "checkbox";
  doc.elements.useragent.setAttribute("aria-invalid", "false");
  doc.elements.useragent.setAttribute("data-error", "useragent-error");
  doc.elements["useragent-error"].textContent = "Error: User-Agent must contain only printable ASCII characters.";
  doc.elements["status-announcer"].setAttribute("aria-live", "polite");
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

test("pressing Enter in #useragent prevents default and flushes immediately", async () => {
  const {state, document} = await loadOptions({storage: {sites: ["naver.com"]}});
  const useragentEl = document.getElementById("useragent");

  useragentEl.focus();
  useragentEl.value = "Enter-Flushed-UA";
  useragentEl.input();

  const event = useragentEl.keydown({key: "Enter", isComposing: false});
  assert.equal(event.defaultPrevented, true);
  await settle();

  assert.equal(state.storage.useragent, "Enter-Flushed-UA");
  assert.equal(state.rules[0].action.requestHeaders[0].value, "Enter-Flushed-UA");
});

test("pressing Enter during IME composition does not flush #useragent", async () => {
  const {chrome, state, document} = await loadOptions({
    storage: {sites: ["naver.com"], useragent: "Saved-UA"}
  });
  const useragentEl = document.getElementById("useragent");
  const sentMessages = [];
  const origSendMessage = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = (message, callback) => {
    sentMessages.push(structuredClone(message));
    return origSendMessage(message, callback);
  };

  useragentEl.focus();
  useragentEl.value = "IME-Pending-UA";
  useragentEl.input();

  useragentEl.keydown({key: "Enter", isComposing: true});
  await settle();
  assert.equal(sentMessages.length, 0);
  assert.equal(state.storage.useragent, "Saved-UA");

  useragentEl.keydown({key: "Enter", isComposing: false, keyCode: 229});
  await settle();
  assert.equal(sentMessages.length, 0);
  assert.equal(state.storage.useragent, "Saved-UA");
});

test("pasting multiline ASCII in #useragent collapses newline to space on commit", async () => {
  const {state, document} = await loadOptions({storage: {sites: ["naver.com"]}});
  const useragentEl = document.getElementById("useragent");

  useragentEl.focus();
  useragentEl.value = "Custom-UA/1.0\r\nMobile";
  useragentEl.input();
  useragentEl.blur();
  await settle();

  assert.equal(state.storage.useragent, "Custom-UA/1.0 Mobile");
  assert.equal(state.rules[0].action.requestHeaders[0].value, "Custom-UA/1.0 Mobile");
  assert.equal(useragentEl.value, "Custom-UA/1.0 Mobile");
});

test("non-ASCII user-agent shows inline error on commit without sending mid-typing and clears on valid input", async () => {
  const {chrome, state, document} = await loadOptions({
    storage: {sites: ["naver.com"], useragent: "Valid-UA/1.0"}
  });
  const useragentEl = document.getElementById("useragent");
  const errorEl = document.getElementById("useragent-error");
  const sentMessages = [];
  const origSendMessage = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = (message, callback) => {
    sentMessages.push(structuredClone(message));
    return origSendMessage(message, callback);
  };

  useragentEl.focus();
  useragentEl.value = "Mozilla/5.0 한글";
  useragentEl.input();
  await settle(350);

  assert.equal(sentMessages.length, 0);
  assert.equal(state.storage.useragent, "Valid-UA/1.0");
  assert.equal(useragentEl.getAttribute("aria-invalid"), "false");
  assert.equal(useragentEl.getAttribute("aria-describedby"), null);
  assert.equal(errorEl.hidden, true);

  const enterEvent = useragentEl.keydown({key: "Enter", isComposing: false});
  assert.equal(enterEvent.defaultPrevented, true);
  await settle();

  assert.equal(useragentEl.getAttribute("aria-invalid"), "true");
  assert.equal(useragentEl.getAttribute("aria-describedby"), "useragent-error");
  assert.equal(errorEl.hidden, false);
  assert.ok(errorEl.textContent.length > 0);
  assert.equal(state.storage.useragent, "Valid-UA/1.0");

  useragentEl.value = "Valid-UA/2.0";
  useragentEl.input();
  assert.equal(useragentEl.getAttribute("aria-invalid"), "false");
  assert.equal(useragentEl.getAttribute("aria-describedby"), null);
  assert.equal(errorEl.hidden, true);
  await settle(350);
  assert.equal(state.storage.useragent, "Valid-UA/2.0");

  useragentEl.value = "Mozilla/5.0 한글";
  useragentEl.input();
  useragentEl.blur();
  await settle();

  assert.equal(useragentEl.getAttribute("aria-invalid"), "true");
  assert.equal(useragentEl.getAttribute("aria-describedby"), "useragent-error");
  assert.equal(errorEl.hidden, false);
  assert.equal(state.storage.useragent, "Valid-UA/2.0");

  useragentEl.focus();
  useragentEl.value = "Valid-UA/3.0";
  useragentEl.input();
  assert.equal(useragentEl.getAttribute("aria-invalid"), "false");
  assert.equal(useragentEl.getAttribute("aria-describedby"), null);
  assert.equal(errorEl.hidden, true);
  await settle(350);
  assert.equal(state.storage.useragent, "Valid-UA/3.0");
});

test("receiving useragentInvalid from background marks #useragent invalid and shows #useragent-error", async () => {
  const {chrome, document} = await loadOptions({storage: {sites: ["naver.com"]}});
  const useragentEl = document.getElementById("useragent");
  const errorEl = document.getElementById("useragent-error");

  chrome.runtime.onMessage.fire({
    path: "background-to-options",
    method: "useragentInvalid",
    data: {}
  });
  await settle();

  assert.equal(useragentEl.getAttribute("aria-invalid"), "true");
  assert.equal(useragentEl.getAttribute("aria-describedby"), "useragent-error");
  assert.equal(errorEl.hidden, false);
  assert.ok(errorEl.textContent.length > 0);
});
