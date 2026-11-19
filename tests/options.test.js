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
  if (id === "useragent-error" || id === "site-error") attributes.hidden = "";

  const element = {
    tagName: tagName.toUpperCase(),
    id,
    className: "",
    type: "",
    value: "",
    checked: false,
    disabled: false,
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
    selectionStart: 0,
    selectionEnd: 0,
    selectionDirection: "none",
    setSelectionRange(start, end, direction = "none") {
      element.selectionStart = start;
      element.selectionEnd = end;
      element.selectionDirection = direction;
    },
    keydown({key = "Enter", shiftKey = false, isComposing = false, keyCode = 0} = {}) {
      return element.dispatch("keydown", {key, shiftKey, isComposing, keyCode});
    },
    click() {
      return element.dispatch("click");
    },
    submit() {
      return element.dispatch("submit");
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

  doc.body = createElement("body", "", doc);
  doc.elements = {
    useragent: createElement("textarea", "useragent", doc),
    "useragent-error": createElement("p", "useragent-error", doc),
    "sites-heading": createElement("h2", "sites-heading", doc),
    "add-site-form": createElement("form", "add-site-form", doc),
    "site-input": createElement("input", "site-input", doc),
    "add-site": createElement("button", "add-site", doc),
    "site-error": createElement("p", "site-error", doc),
    sites: createElement("ul", "sites", doc),
    "bypass-cache": createElement("input", "bypass-cache", doc),
    "status-announcer": createElement("div", "status-announcer", doc)
  };
  doc.elements["bypass-cache"].type = "checkbox";
  doc.elements["sites-heading"].textContent = "Mobile View Sites";
  doc.elements["sites-heading"].setAttribute("tabindex", "-1");
  doc.elements.useragent.setAttribute("aria-invalid", "false");
  doc.elements.useragent.setAttribute("data-error", "useragent-error");
  doc.elements["useragent-error"].textContent = "Error: User-Agent must contain only printable ASCII characters.";
  doc.elements["site-input"].type = "text";
  doc.elements["site-input"].setAttribute("aria-invalid", "false");
  doc.elements["site-input"].setAttribute("data-error", "site-error");
  doc.elements["add-site"].type = "submit";
  doc.elements["site-error"].hidden = true;
  doc.elements["status-announcer"].setAttribute("aria-live", "polite");
  return doc;
}

function createDeterministicTimers() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimeout(fn, delay = 0) {
      const id = nextId++;
      tasks.set(id, {id, runAt: now + Math.max(0, Number(delay) || 0), fn});
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    tick(ms) {
      const target = now + ms;
      while (true) {
        let earliest = null;
        for (const task of tasks.values()) {
          if (task.runAt <= target && (!earliest || task.runAt < earliest.runAt || (task.runAt === earliest.runAt && task.id < earliest.id))) {
            earliest = task;
          }
        }
        if (!earliest) break;
        tasks.delete(earliest.id);
        now = earliest.runAt;
        earliest.fn();
      }
      now = target;
    },
    pendingCount() {
      return tasks.size;
    },
    clearAll() {
      tasks.clear();
    }
  };
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

function mountOptionsPage(chrome, {t = null, timers = null} = {}) {
  const document = createDocument();
  const window = createOptionsWindow();
  const pendingTimers = new Set();
  const timerApi = timers || {
    setTimeout(fn, delay) {
      const id = setTimeout(() => {
        pendingTimers.delete(id);
        fn();
      }, delay);
      pendingTimers.add(id);
      return id;
    },
    clearTimeout(id) {
      pendingTimers.delete(id);
      clearTimeout(id);
    }
  };
  if (t && typeof t.after === "function") {
    t.after(() => {
      for (const id of pendingTimers) clearTimeout(id);
      pendingTimers.clear();
      if (timers && typeof timers.clearAll === "function") timers.clearAll();
    });
  }
  const optionsContext = vm.createContext({
    chrome,
    document,
    window,
    console,
    setTimeout: timerApi.setTimeout,
    clearTimeout: timerApi.clearTimeout
  });
  vm.runInContext(read("data/options/options.js"), optionsContext, {filename: "data/options/options.js"});
  document.dispatch("DOMContentLoaded");
  return {document, window, optionsContext, pendingTimers};
}

async function loadOptions(backgroundOptions, {waitForLoad = true, t = null, timers = null, sentMessages = null, setupChrome = null} = {}) {
  const {chrome, state, context} = loadBackground(backgroundOptions);
  if (typeof setupChrome === "function") {
    setupChrome(chrome, state, context);
  }
  if (Array.isArray(sentMessages)) {
    const origSendMessage = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (message, optionsOrCallback, maybeCallback, sender) => {
      sentMessages.push(structuredClone(message));
      return origSendMessage(message, optionsOrCallback, maybeCallback, sender);
    };
  }
  const page = mountOptionsPage(chrome, {t, timers});
  if (waitForLoad) await settle();
  return {chrome, state, context, ...page};
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

test("focused typing in #useragent debounces save and preserves value while focused", async (t) => {
  const timers = createDeterministicTimers();
  const {state, document} = await loadOptions({storage: {sites: ["naver.com"]}}, {t, timers});
  const useragentEl = document.getElementById("useragent");

  useragentEl.focus();
  useragentEl.value = "Mobile-UA ";
  useragentEl.input();
  timers.tick(299);
  assert.equal(state.storage.useragent, undefined);
  timers.tick(1);
  await settle();

  assert.equal(state.storage.useragent, "Mobile-UA");
  assert.equal(state.rules[0].action.requestHeaders[0].value, "Mobile-UA");
  assert.equal(useragentEl.value, "Mobile-UA ");
  assert.equal(timers.pendingCount(), 0);
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

test("clearing #useragent during focused input keeps value before commit and resets on blur", async (t) => {
  const timers = createDeterministicTimers();
  const {state, context, document} = await loadOptions({
    storage: {sites: ["naver.com"], useragent: "Custom-UA"}
  }, {t, timers});
  const useragentEl = document.getElementById("useragent");

  useragentEl.focus();
  useragentEl.value = "   ";
  useragentEl.input();
  timers.tick(300);
  await settle();
  assert.equal(useragentEl.value, "   ");
  assert.equal(state.storage.useragent, "Custom-UA");

  useragentEl.blur();
  await settle();
  assert.equal("useragent" in state.storage, false);
  assert.equal(state.rules[0].action.requestHeaders[0].value, context.defaults.useragent);
  assert.equal(useragentEl.value, context.defaults.useragent);
  assert.equal(timers.pendingCount(), 0);
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

test("pressing Enter during IME composition does not prevent default or flush #useragent", async (t) => {
  const timers = createDeterministicTimers();
  const {chrome, state, document} = await loadOptions({
    storage: {sites: ["naver.com"], useragent: "Saved-UA"}
  }, {t, timers});
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
  assert.equal(timers.pendingCount(), 1);

  const ev1 = useragentEl.keydown({key: "Enter", isComposing: true});
  assert.equal(ev1.defaultPrevented, false);
  await settle();
  assert.equal(sentMessages.length, 0);
  assert.equal(state.storage.useragent, "Saved-UA");

  const ev2 = useragentEl.keydown({key: "Enter", isComposing: false, keyCode: 229});
  assert.equal(ev2.defaultPrevented, false);
  await settle();
  assert.equal(sentMessages.length, 0);
  assert.equal(state.storage.useragent, "Saved-UA");

  /* Clear debounce timer by reverting to saved value */
  useragentEl.value = "Saved-UA";
  useragentEl.input();
  assert.equal(timers.pendingCount(), 0);
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

test("non-ASCII user-agent shows inline error on commit without sending mid-typing and clears on valid input", async (t) => {
  const timers = createDeterministicTimers();
  const {chrome, state, document} = await loadOptions({
    storage: {sites: ["naver.com"], useragent: "Valid-UA/1.0"}
  }, {t, timers});
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
  timers.tick(300);
  await settle();

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
  timers.tick(300);
  await settle();
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
  timers.tick(300);
  await settle();
  assert.equal(state.storage.useragent, "Valid-UA/3.0");
  assert.equal(timers.pendingCount(), 0);
});

test("receiving useragentInvalid from background marks #useragent invalid and shows #useragent-error", async (t) => {
  const timers = createDeterministicTimers();
  const {chrome, document} = await loadOptions({storage: {sites: ["naver.com"]}}, {t, timers});
  const useragentEl = document.getElementById("useragent");
  const errorEl = document.getElementById("useragent-error");
  const announcer = document.getElementById("status-announcer");

  chrome.runtime.onMessage.fire({
    path: "background-to-options",
    method: "useragentInvalid",
    data: {}
  });
  timers.tick(500);
  await settle();

  assert.equal(useragentEl.getAttribute("aria-invalid"), "true");
  assert.equal(useragentEl.getAttribute("aria-describedby"), "useragent-error");
  assert.equal(errorEl.hidden, false);
  assert.ok(errorEl.textContent.length > 0);
  assert.equal(announcer.textContent, errorEl.textContent);
  assert.equal(timers.pendingCount(), 0);
});


test("events before initial settings load never overwrite saved custom useragent", async (t) => {
  const sentMessages = [];
  const {state, document, window, pendingTimers} = await loadOptions(
    {storage: {sites: ["naver.com"], useragent: "Saved-Custom-UA"}},
    {waitForLoad: false, t, sentMessages}
  );
  const useragentEl = document.getElementById("useragent");

  assert.equal(useragentEl.value, "");

  useragentEl.focus();
  useragentEl.blur();
  document.visibilityState = "hidden";
  document.dispatch("visibilitychange");
  window.dispatch("pagehide");

  /* Keep #useragent focused while initial "settings" is still in flight */
  useragentEl.focus();
  assert.equal(sentMessages.filter((m) => m.method === "useragent").length, 0);

  await settle();
  assert.equal(sentMessages.filter((m) => m.method === "useragent").length, 0);
  assert.equal(state.storage.useragent, "Saved-Custom-UA");
  assert.equal(useragentEl.value, "Saved-Custom-UA");

  document.visibilityState = "visible";
  useragentEl.blur();
  await settle();
  assert.equal(sentMessages.filter((m) => m.method === "useragent").length, 0);
  assert.equal(state.storage.useragent, "Saved-Custom-UA");
  assert.equal(pendingTimers.size, 0);
});

test("useragentInvalid with apply reason rolls back lastSent and repeated invalid commits re-announce", async (t) => {
  const timers = createDeterministicTimers();
  const sentMessages = [];
  const {state, document} = await loadOptions(
    {storage: {sites: ["naver.com"], useragent: "Prev-UA"}},
    {t, timers, sentMessages}
  );
  const useragentEl = document.getElementById("useragent");
  const errorEl = document.getElementById("useragent-error");
  const announcer = document.getElementById("status-announcer");

  /* Simulate storage/apply failure so background sends useragentInvalid {useragent: "Prev-UA", reason: "apply"} */
  state.storageWriteError = {message: "QuotaExceeded"};
  sentMessages.length = 0;

  useragentEl.focus();
  useragentEl.value = "Fail-Apply-UA";
  useragentEl.input();
  useragentEl.blur();
  await settle();
  timers.tick(500);

  assert.equal(sentMessages.filter((m) => m.method === "useragent").length, 1);
  assert.equal(useragentEl.getAttribute("aria-invalid"), "true");
  assert.equal(errorEl.hidden, false);
  assert.equal(errorEl.textContent, "Error: Could not apply User-Agent string.");
  assert.equal(announcer.textContent, "Error: Could not apply User-Agent string.");
  assert.equal(state.storage.useragent, "Prev-UA");

  /* Focus and blur again without editing: lastSent rolled back to "Prev-UA", so it re-sends instead of clearing */
  useragentEl.focus();
  useragentEl.blur();
  await settle();
  assert.equal(announcer.textContent, "");
  timers.tick(500);
  assert.equal(sentMessages.filter((m) => m.method === "useragent").length, 2);
  assert.equal(useragentEl.getAttribute("aria-invalid"), "true");
  assert.equal(errorEl.textContent, "Error: Could not apply User-Agent string.");
  assert.equal(announcer.textContent, "Error: Could not apply User-Agent string.");

  /* Once write error resolves, another blur succeeds */
  state.storageWriteError = null;
  useragentEl.focus();
  useragentEl.blur();
  await settle();
  assert.equal(sentMessages.filter((m) => m.method === "useragent").length, 3);
  assert.equal(useragentEl.getAttribute("aria-invalid"), "false");
  assert.equal(errorEl.hidden, true);
  assert.equal(state.storage.useragent, "Fail-Apply-UA");

  /* Repeated invalid Enter / blur clears and re-announces in #status-announcer */
  useragentEl.focus();
  useragentEl.value = "Bad 한글";
  useragentEl.input();
  useragentEl.keydown({key: "Enter", isComposing: false});
  timers.tick(500);
  await settle();
  assert.equal(announcer.textContent, "Error: User-Agent must contain only printable ASCII characters.");

  useragentEl.keydown({key: "Enter", isComposing: false});
  assert.equal(announcer.textContent, "");
  timers.tick(500);
  assert.equal(announcer.textContent, "Error: User-Agent must contain only printable ASCII characters.");

  useragentEl.blur();
  assert.equal(announcer.textContent, "");
  timers.tick(500);
  await settle();
  assert.equal(announcer.textContent, "Error: User-Agent must contain only printable ASCII characters.");
  assert.equal(timers.pendingCount(), 0);
});

test("renderSettings protects invalid drafts, focused edits, and rapid in-flight submissions", async (t) => {
  /* 1. Invalid draft + blur ignores external "settings" overwrite */
  {
    const timers = createDeterministicTimers();
    const {chrome, document} = await loadOptions(
      {storage: {sites: ["naver.com"], useragent: "Initial-UA"}},
      {t, timers}
    );
    const useragentEl = document.getElementById("useragent");
    const errorEl = document.getElementById("useragent-error");

    useragentEl.focus();
    useragentEl.value = "Bad 한글";
    useragentEl.input();
    useragentEl.blur();

    chrome.runtime.onMessage.fire({
      path: "background-to-options",
      method: "settings",
      data: {bypassCache: false, useragent: "External-UA"}
    });
    timers.tick(500);
    await settle();

    assert.equal(document.getElementById("bypass-cache").checked, false);
    assert.equal(useragentEl.value, "Bad 한글");
    assert.equal(useragentEl.getAttribute("aria-invalid"), "true");
    assert.equal(errorEl.hidden, false);
    assert.equal(timers.pendingCount(), 0);
  }

  /* 2. Focused editing is not overwritten by external "settings" */
  {
    const timers = createDeterministicTimers();
    const {chrome, document} = await loadOptions(
      {storage: {sites: ["naver.com"], useragent: "Initial-UA"}},
      {t, timers}
    );
    const useragentEl = document.getElementById("useragent");
    useragentEl.focus();
    useragentEl.value = "Focused-Draft";
    useragentEl.input();

    chrome.runtime.onMessage.fire({
      path: "background-to-options",
      method: "settings",
      data: {bypassCache: false, useragent: "External-UA"}
    });
    assert.equal(useragentEl.value, "Focused-Draft");
    timers.tick(300);
    await settle();
    assert.equal(timers.pendingCount(), 0);
  }

  /* 3. Rapid #1 ("UA-1") + #2 ("UA-12") in-flight ignores arriving #1 "settings" even after blur */
  {
    const {state, document, optionsContext, pendingTimers} = await loadOptions(
      {storage: {sites: ["naver.com"], useragent: "Initial-UA"}},
      {t}
    );
    const useragentEl = document.getElementById("useragent");
    const snapshots = [];
    const origRenderSettings = optionsContext.background.message.settings;
    optionsContext.background.message.settings = (data) => {
      origRenderSettings(data);
      snapshots.push({incoming: data.useragent, valueAfter: useragentEl.value});
    };

    useragentEl.focus();
    useragentEl.value = "UA-1";
    useragentEl.change();
    useragentEl.value = "UA-12";
    useragentEl.change();
    useragentEl.blur();

    await settle();
    assert.equal(snapshots.length, 2);
    assert.deepEqual(snapshots[0], {incoming: "UA-1", valueAfter: "UA-12"});
    assert.deepEqual(snapshots[1], {incoming: "UA-12", valueAfter: "UA-12"});
    assert.equal(useragentEl.value, "UA-12");
    assert.equal(state.storage.useragent, "UA-12");
    assert.equal(pendingTimers.size, 0);
  }
});

test("sites Remove button moves focus cleanly, announces removal, and toolbar toggle preserves focus", async (t) => {
  const tabs = [{id: 1, url: "https://m.b.com/"}];
  const {chrome, state, document, pendingTimers} = await loadOptions(
    {tabs, storage: {sites: ["a.com", "b.com"]}},
    {t}
  );
  const announcer = document.getElementById("status-announcer");
  const heading = document.getElementById("sites-heading");

  /* Focus and click Remove on first site ("a.com") -> focus moves to "b.com" Remove button */
  let items = document.getElementById("sites").children;
  const firstBtn = items[0].children[1];
  firstBtn.focus();
  firstBtn.click();
  await settle();

  assert.equal(announcer.textContent, "Removed a.com.");
  items = document.getElementById("sites").children;
  assert.equal(items.length, 1);
  assert.equal(items[0].children[0].textContent, "b.com");
  assert.equal(document.activeElement, items[0].children[1]);

  /* Click last remaining Remove button while focused -> focus moves to #sites-heading */
  items[0].children[1].click();
  await settle();

  assert.equal(announcer.textContent, "Removed b.com.");
  assert.equal(document.activeElement, heading);
  assert.equal(document.getElementById("sites").children[0].className, "empty");

  /* Re-add "b.com", focus #bypass-cache, then remove via toolbar toggle -> does not steal focus */
  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();
  const bypassEl = document.getElementById("bypass-cache");
  bypassEl.focus();
  announcer.textContent = "";

  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();
  assert.deepEqual(state.storage.sites, []);
  assert.equal(document.activeElement, bypassEl);
  assert.equal(announcer.textContent, "");
  assert.equal(pendingTimers.size, 0);
});

test("empty textarea preserves value on visibilitychange, supports Enter resetPending, and preserves selection offsets", async (t) => {
  /* 1. Empty textarea preserved on visibilitychange, then reset on blur and pagehide */
  {
    const {state, context, document, window, pendingTimers} = await loadOptions(
      {storage: {sites: ["naver.com"], useragent: "Custom-UA"}},
      {t}
    );
    const useragentEl = document.getElementById("useragent");

    useragentEl.focus();
    useragentEl.value = "";
    useragentEl.input();

    document.visibilityState = "hidden";
    document.dispatch("visibilitychange");
    await settle();
    assert.equal(useragentEl.value, "");
    assert.equal(state.storage.useragent, "Custom-UA");

    document.visibilityState = "visible";
    useragentEl.blur();
    await settle();
    assert.equal("useragent" in state.storage, false);
    assert.equal(useragentEl.value, context.defaults.useragent);

    useragentEl.focus();
    useragentEl.value = "Custom-UA-2";
    useragentEl.change();
    await settle();
    assert.equal(state.storage.useragent, "Custom-UA-2");

    useragentEl.value = "";
    useragentEl.input();
    window.dispatch("pagehide");
    await settle();
    assert.equal("useragent" in state.storage, false);
    assert.equal(useragentEl.value, context.defaults.useragent);
    assert.equal(pendingTimers.size, 0);
  }

  /* 2. Focused Enter on empty box sets resetPending and applies background "settings" reset */
  {
    const {state, context, document, pendingTimers} = await loadOptions(
      {storage: {sites: ["naver.com"], useragent: "Custom-UA"}},
      {t}
    );
    const useragentEl = document.getElementById("useragent");
    useragentEl.focus();
    useragentEl.value = "   ";
    useragentEl.input();

    const ev = useragentEl.keydown({key: "Enter", isComposing: false});
    assert.equal(ev.defaultPrevented, true);
    await settle();

    assert.equal(document.activeElement, useragentEl);
    assert.equal("useragent" in state.storage, false);
    assert.equal(useragentEl.value, context.defaults.useragent);
    assert.equal(pendingTimers.size, 0);
  }

  /* 3. Focused multiline normalize preserves selection offsets on both debounce and commit */
  {
    const timers = createDeterministicTimers();
    const {state, document} = await loadOptions(
      {storage: {sites: ["naver.com"]}},
      {t, timers}
    );
    const useragentEl = document.getElementById("useragent");
    useragentEl.focus();

    useragentEl.value = "  AA\r\n\tBB  ";
    useragentEl.setSelectionRange(7, 9, "forward");
    useragentEl.input();
    timers.tick(300);
    await settle();

    assert.equal(useragentEl.value, "  AA BB  ");
    assert.equal(useragentEl.selectionStart, 5);
    assert.equal(useragentEl.selectionEnd, 7);
    assert.equal(useragentEl.selectionDirection, "forward");
    assert.equal(state.storage.useragent, "AA BB");

    useragentEl.value = "  CC\r\nDD  ";
    useragentEl.setSelectionRange(6, 8, "backward");
    useragentEl.keydown({key: "Enter", isComposing: false});
    await settle();

    assert.equal(useragentEl.value, "CC DD");
    assert.equal(useragentEl.selectionStart, 3);
    assert.equal(useragentEl.selectionEnd, 5);
    assert.equal(useragentEl.selectionDirection, "backward");
    assert.equal(state.storage.useragent, "CC DD");
    assert.equal(timers.pendingCount(), 0);
  }
});

test("status-announcer uses 500ms timer without .unref(), cancels on valid input, and visible visibilitychange does not flush", async (t) => {
  assert.equal(/\.unref\b/.test(read("data/options/options.js")), false);

  const timers = createDeterministicTimers();
  const {state, document} = await loadOptions(
    {storage: {sites: ["naver.com"], useragent: "Saved-UA"}},
    {t, timers}
  );
  const useragentEl = document.getElementById("useragent");
  const announcer = document.getElementById("status-announcer");

  /* Commit invalid UA: announcer stays empty at 499ms and populates at 500ms */
  useragentEl.focus();
  useragentEl.value = "Bad 한글";
  useragentEl.input();
  useragentEl.keydown({key: "Enter", isComposing: false});
  assert.equal(announcer.textContent, "");

  timers.tick(499);
  assert.equal(announcer.textContent, "");
  timers.tick(1);
  assert.equal(announcer.textContent, "Error: User-Agent must contain only printable ASCII characters.");

  /* Second invalid Enter clears immediately, and valid input before 500ms cancels announcement */
  useragentEl.keydown({key: "Enter", isComposing: false});
  assert.equal(announcer.textContent, "");
  timers.tick(400);
  assert.equal(announcer.textContent, "");

  useragentEl.value = "Valid-After-Error";
  useragentEl.input();
  assert.equal(useragentEl.getAttribute("aria-invalid"), "false");
  timers.tick(200);
  assert.equal(announcer.textContent, "");
  timers.tick(150);
  await settle();
  assert.equal(state.storage.useragent, "Valid-After-Error");

  /* visibilityState === "visible" visibilitychange does NOT flush */
  useragentEl.value = "Not-Flushed-Visible";
  useragentEl.input();
  document.visibilityState = "visible";
  document.dispatch("visibilitychange");
  await settle();
  assert.equal(state.storage.useragent, "Valid-After-Error");

  timers.tick(300);
  await settle();
  assert.equal(state.storage.useragent, "Not-Flushed-Visible");
  assert.equal(timers.pendingCount(), 0);
});

test("trailing space alignment trims committed value and suppresses duplicate blur/change messages", async (t) => {
  const timers = createDeterministicTimers();
  const sentMessages = [];
  const {state, document} = await loadOptions(
    {storage: {sites: ["naver.com"]}},
    {t, timers, sentMessages}
  );
  const useragentEl = document.getElementById("useragent");

  /* 1. "Custom-UA " on blur trims value, sends once, and subsequent blur sends zero duplicates */
  sentMessages.length = 0;
  useragentEl.focus();
  useragentEl.value = "Custom-UA ";
  useragentEl.blur();
  await settle();

  assert.equal(useragentEl.value, "Custom-UA");
  assert.equal(state.storage.useragent, "Custom-UA");
  assert.equal(sentMessages.filter((m) => m.method === "useragent").length, 1);

  useragentEl.focus();
  useragentEl.blur();
  await settle();
  assert.equal(sentMessages.filter((m) => m.method === "useragent").length, 1);

  /* 2. change then blur sends only 1 message */
  sentMessages.length = 0;
  useragentEl.focus();
  useragentEl.value = "Custom-UA-2 ";
  useragentEl.change();
  useragentEl.blur();
  await settle();

  assert.equal(useragentEl.value, "Custom-UA-2");
  assert.equal(state.storage.useragent, "Custom-UA-2");
  assert.equal(sentMessages.filter((m) => m.method === "useragent").length, 1);

  /* 3. Debounced input with trailing space followed by blur sends only 1 message */
  sentMessages.length = 0;
  useragentEl.focus();
  useragentEl.value = "Custom-UA-3 ";
  useragentEl.input();
  timers.tick(300);
  await settle();

  assert.equal(useragentEl.value, "Custom-UA-3 ");
  assert.equal(state.storage.useragent, "Custom-UA-3");
  assert.equal(sentMessages.filter((m) => m.method === "useragent").length, 1);

  useragentEl.blur();
  await settle();
  assert.equal(useragentEl.value, "Custom-UA-3");
  assert.equal(sentMessages.filter((m) => m.method === "useragent").length, 1);
  assert.equal(timers.pendingCount(), 0);
});

test("delayed initial load settings never overwrite fast user edit committed before load reply arrives", async (t) => {
  const heldSettings = [];
  const {state, document, pendingTimers} = await loadOptions(
    {storage: {sites: ["naver.com"], useragent: "Old-Saved-UA"}},
    {
      waitForLoad: false,
      t,
      setupChrome(chromeObj) {
        const origSendMessage = chromeObj.runtime.sendMessage.bind(chromeObj.runtime);
        chromeObj.runtime.sendMessage = (message, optionsOrCallback, maybeCallback, sender) => {
          if (message && message.path === "background-to-options" && message.method === "settings") {
            return new Promise((resolve) => {
              heldSettings.push({
                message: structuredClone(message),
                deliver: () => origSendMessage(message, optionsOrCallback, maybeCallback, sender).then(resolve)
              });
            });
          }
          return origSendMessage(message, optionsOrCallback, maybeCallback, sender);
        };
      }
    }
  );
  await settle();
  assert.equal(heldSettings.length, 1);
  assert.equal(heldSettings[0].message.data.useragent, "Old-Saved-UA");
  assert.equal("clientId" in heldSettings[0].message.data, false);

  const useragentEl = document.getElementById("useragent");
  useragentEl.focus();
  useragentEl.value = "Fast-Edit-UA";
  useragentEl.input();
  useragentEl.blur();
  await settle();

  assert.equal(heldSettings.length, 2);
  assert.equal(heldSettings[1].message.data.useragent, "Fast-Edit-UA");
  assert.equal(typeof heldSettings[1].message.data.clientId, "string");

  /* Deliver delayed initial "load" settings while Fast-Edit-UA request is still pending client-side */
  await heldSettings[0].deliver();
  await settle();
  assert.equal(useragentEl.value, "Fast-Edit-UA");

  /* Deliver Fast-Edit-UA's own settings reply */
  await heldSettings[1].deliver();
  await settle();
  assert.equal(useragentEl.value, "Fast-Edit-UA");
  assert.equal(state.storage.useragent, "Fast-Edit-UA");
  assert.equal(pendingTimers.size, 0);
});

test("failed useragent IPC ({ok: false} on storage.load failure) does not permanently wedge options.js", async (t) => {
  const timers = createDeterministicTimers();
  const responses = [];
  const sentToOptions = [];
  const {chrome, state, context, document} = await loadOptions(
    {storage: {sites: ["naver.com"], useragent: "Prev-UA"}},
    {
      t,
      timers,
      setupChrome(chromeObj) {
        const origSendMessage = chromeObj.runtime.sendMessage.bind(chromeObj.runtime);
        chromeObj.runtime.sendMessage = (message, optionsOrCallback, maybeCallback, sender) => {
          if (message && message.path === "background-to-options") {
            sentToOptions.push(structuredClone(message));
          }
          if (message && message.path === "options-to-background" && message.method === "useragent") {
            const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
            const wrappedCb = (res) => {
              responses.push(structuredClone(res));
              if (typeof cb === "function") cb(res);
            };
            return origSendMessage(
              message,
              typeof optionsOrCallback === "function" ? wrappedCb : optionsOrCallback,
              typeof optionsOrCallback === "function" ? maybeCallback : wrappedCb,
              sender
            );
          }
          return origSendMessage(message, optionsOrCallback, maybeCallback, sender);
        };
      }
    }
  );
  const useragentEl = document.getElementById("useragent");
  const errorEl = document.getElementById("useragent-error");
  const announcer = document.getElementById("status-announcer");
  assert.equal(useragentEl.value, "Prev-UA");

  /* Simulate wake-up storage.load failure so background returns {ok: false} without emitting settings */
  sentToOptions.length = 0;
  context.app.storage.ready = null;
  state.storageGetError = {message: "disk error"};

  useragentEl.focus();
  useragentEl.value = "Fail-Read-UA";
  useragentEl.input();
  useragentEl.blur();
  await settle();

  assert.deepEqual(responses, [{ok: false}]);
  assert.equal(sentToOptions.filter((m) => m.method === "settings").length, 0);
  assert.equal(state.storage.useragent, "Prev-UA");

  /* Verify callback cleared pendingRequestId so unkeyed background useragentInvalid is not dropped */
  chrome.runtime.onMessage.fire({
    path: "background-to-options",
    method: "useragentInvalid",
    data: {useragent: "Prev-UA", reason: "apply"}
  });
  assert.equal(useragentEl.getAttribute("aria-invalid"), "true");

  /* Clear storage error and verify valid commit, empty reset, and invalid input all work */
  state.storageGetError = null;
  useragentEl.focus();
  useragentEl.value = "Recovered-UA";
  useragentEl.input();
  useragentEl.blur();
  await settle();

  assert.deepEqual(responses.at(-1), {ok: true});
  assert.equal(state.storage.useragent, "Recovered-UA");
  assert.equal(useragentEl.value, "Recovered-UA");
  assert.equal(useragentEl.getAttribute("aria-invalid"), "false");
  assert.equal(errorEl.hidden, true);

  useragentEl.focus();
  useragentEl.value = "";
  useragentEl.input();
  useragentEl.keydown({key: "Enter", isComposing: false});
  await settle();

  assert.equal("useragent" in state.storage, false);
  assert.equal(useragentEl.value, context.defaults.useragent);
  assert.equal(useragentEl.getAttribute("aria-invalid"), "false");

  useragentEl.value = "Mozilla/5.0 한글";
  useragentEl.input();
  useragentEl.keydown({key: "Enter", isComposing: false});
  timers.tick(500);
  await settle();

  assert.equal(useragentEl.getAttribute("aria-invalid"), "true");
  assert.equal(useragentEl.getAttribute("aria-describedby"), "useragent-error");
  assert.equal(errorEl.hidden, false);
  assert.equal(announcer.textContent, errorEl.textContent);
  assert.equal(timers.pendingCount(), 0);
});

test("two options tabs sharing chrome mock do not cross-contaminate settings or useragentInvalid", async (t) => {
  const timers = createDeterministicTimers();
  const {chrome, state} = loadBackground({
    storage: {sites: ["naver.com"], useragent: "Old-UA"}
  });

  let holdTabA = false;
  const heldTabARequests = [];
  const clientIds = [];
  const origSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (message, optionsOrCallback, maybeCallback, sender) => {
    if (message && message.path === "options-to-background" && message.method === "useragent") {
      if (message.data && message.data.clientId) clientIds.push(message.data.clientId);
      if (holdTabA) {
        holdTabA = false;
        return new Promise((resolve) => {
          heldTabARequests.push(() => origSendMessage(message, optionsOrCallback, maybeCallback, sender).then(resolve));
        });
      }
    }
    return origSendMessage(message, optionsOrCallback, maybeCallback, sender);
  };

  const tabA = mountOptionsPage(chrome, {t, timers});
  await settle();
  const elA = tabA.document.getElementById("useragent");
  const errorA = tabA.document.getElementById("useragent-error");
  const announcerA = tabA.document.getElementById("status-announcer");
  assert.equal(elA.value, "Old-UA");

  /* Tab A starts an in-flight edit ("TabA-UA") */
  holdTabA = true;
  elA.focus();
  elA.value = "TabA-UA";
  elA.input();
  elA.blur();
  assert.equal(heldTabARequests.length, 1);

  /* Tab B loads concurrently -> Tab B's "Old-UA" settings do NOT overwrite Tab A */
  const tabB = mountOptionsPage(chrome, {t, timers});
  await settle();
  const elB = tabB.document.getElementById("useragent");
  assert.equal(elB.value, "Old-UA");
  assert.equal(elA.value, "TabA-UA");

  /* While Tab A is in-flight, Tab B triggers useragentInvalid -> Tab A stays clean */
  state.storageWriteError = {message: "QuotaExceeded"};
  elB.focus();
  elB.value = "TabB-Fail-UA";
  elB.input();
  elB.blur();
  await settle();
  timers.tick(500);

  assert.equal(elB.getAttribute("aria-invalid"), "true");
  assert.equal(elA.getAttribute("aria-invalid"), "false");
  assert.equal(errorA.hidden, true);
  assert.equal(announcerA.textContent, "");
  assert.equal(elA.value, "TabA-UA");

  /* Complete Tab A's in-flight edit so Tab A becomes idle (pendingRequestId === null) */
  state.storageWriteError = null;
  await heldTabARequests.shift()();
  await settle();

  assert.equal(state.storage.useragent, "TabA-UA");
  assert.equal(elA.value, "TabA-UA");
  assert.equal(elA.getAttribute("aria-invalid"), "false");

  /* Even when Tab A is idle, Tab B's useragentInvalid does NOT mark Tab A invalid */
  state.storageWriteError = {message: "QuotaExceeded"};
  elB.focus();
  elB.value = "TabB-Fail-2";
  elB.input();
  elB.blur();
  await settle();
  timers.tick(500);
  await settle();

  assert.equal(elB.getAttribute("aria-invalid"), "true");
  assert.equal(elA.getAttribute("aria-invalid"), "false");
  assert.equal(errorA.hidden, true);
  assert.equal(announcerA.textContent, "");
  assert.equal(elA.value, "TabA-UA");
  assert.equal(state.storage.useragent, "TabA-UA");
  assert.notEqual(clientIds[0], clientIds[1]);
  assert.equal(timers.pendingCount(), 0);
});

test("typing then deleting a character while empty reset IPC is in flight does not trap lastSent at empty string", async (t) => {
  const timers = createDeterministicTimers();
  const sentMessages = [];
  const heldResetSettings = [];
  let holdNextResetSettings = false;

  const {state, context, document} = await loadOptions(
    {storage: {sites: ["naver.com"], useragent: "Custom-UA"}},
    {
      t,
      timers,
      sentMessages,
      setupChrome(chromeObj) {
        const origSendMessage = chromeObj.runtime.sendMessage.bind(chromeObj.runtime);
        chromeObj.runtime.sendMessage = (message, optionsOrCallback, maybeCallback, sender) => {
          if (holdNextResetSettings && message && message.path === "background-to-options" && message.method === "settings") {
            holdNextResetSettings = false;
            return new Promise((resolve) => {
              heldResetSettings.push({
                message: structuredClone(message),
                deliver: () => origSendMessage(message, optionsOrCallback, maybeCallback, sender).then(resolve)
              });
            });
          }
          return origSendMessage(message, optionsOrCallback, maybeCallback, sender);
        };
      }
    }
  );
  const useragentEl = document.getElementById("useragent");
  sentMessages.length = 0;

  /* 1. Clear textarea and hit Enter -> "useragent": "" sent, hold background "settings" response */
  holdNextResetSettings = true;
  useragentEl.focus();
  useragentEl.value = "";
  useragentEl.input();
  useragentEl.keydown({key: "Enter", isComposing: false});
  await settle();

  assert.equal(sentMessages.filter((m) => m.method === "useragent").length, 1);
  assert.equal(sentMessages.find((m) => m.method === "useragent").data.useragent, "");
  assert.equal(heldResetSettings.length, 1);
  assert.equal(heldResetSettings[0].message.data.useragent, context.defaults.useragent);

  /* 2. User types "x" before held reset "settings" arrives; reset response must preserve "x" */
  useragentEl.value = "x";
  useragentEl.input();
  await heldResetSettings[0].deliver();
  await settle();

  assert.equal(useragentEl.value, "x");
  assert.equal(sentMessages.filter((m) => m.method === "useragent").length, 1);

  /* 3. User backspaces "x" back to "" and hits Enter -> second reset IS sent and refills default UA */
  useragentEl.value = "";
  useragentEl.input();
  useragentEl.keydown({key: "Enter", isComposing: false});
  await settle();

  const useragentMsgs = sentMessages.filter((m) => m.method === "useragent");
  assert.equal(useragentMsgs.length, 2);
  assert.equal(useragentMsgs[1].data.useragent, "");
  assert.equal("useragent" in state.storage, false);
  assert.equal(useragentEl.value, context.defaults.useragent);
  assert.equal(timers.pendingCount(), 0);
});

test("adding valid URL via #add-site-form preserves subdomain, updates tabs/sites, and subsumes under parent", async (t) => {
  const tabs = [
    {id: 1, url: "https://news.naver.com/article/1"},
    {id: 2, url: "https://www.naver.com/"}
  ];
  const {state, document, pendingTimers} = await loadOptions({tabs}, {t});
  const addForm = document.getElementById("add-site-form");
  const siteInput = document.getElementById("site-input");
  const addButton = document.getElementById("add-site");
  const siteError = document.getElementById("site-error");
  const announcer = document.getElementById("status-announcer");

  siteInput.focus();
  siteInput.value = "https://news.naver.com/article";
  const submitEvent = addForm.submit();
  assert.equal(submitEvent.defaultPrevented, true);
  await settle();

  assert.equal(addButton.disabled, false);
  assert.equal(siteInput.value, "");
  assert.equal(siteInput.getAttribute("aria-invalid"), "false");
  assert.equal(siteInput.getAttribute("aria-describedby"), null);
  assert.equal(siteError.hidden, true);
  assert.equal(document.activeElement, siteInput);
  assert.equal(announcer.textContent, "Added news.naver.com.");
  assert.deepEqual(state.storage.sites, ["news.naver.com"]);
  assert.deepEqual(state.icons, {1: "ON", 2: "OFF"});

  let items = document.getElementById("sites").children;
  assert.equal(items.length, 1);
  assert.equal(items[0].children[0].textContent, "news.naver.com");
  assert.equal(items[0].children[1].getAttribute("aria-label"), "Remove news.naver.com");

  /* Adding parent domain subsumes existing subdomain into ["naver.com"] */
  siteInput.value = "naver.com";
  const parentSubmit = addForm.submit();
  assert.equal(parentSubmit.defaultPrevented, true);
  await settle();

  assert.equal(siteInput.value, "");
  assert.equal(document.activeElement, siteInput);
  assert.equal(announcer.textContent, "Added naver.com.");
  assert.deepEqual(state.storage.sites, ["naver.com"]);
  assert.deepEqual(state.icons, {1: "ON", 2: "ON"});

  items = document.getElementById("sites").children;
  assert.equal(items.length, 1);
  assert.equal(items[0].children[0].textContent, "naver.com");
  assert.equal(items[0].children[1].getAttribute("aria-label"), "Remove naver.com");
  assert.equal(pendingTimers.size, 0);
});

test("site add form handles empty, invalid, duplicate, covered, and apply errors with accessible feedback", async (t) => {
  const timers = createDeterministicTimers();
  const sentMessages = [];
  const {state, document} = await loadOptions(
    {storage: {sites: ["naver.com"]}},
    {t, timers, sentMessages}
  );
  const addForm = document.getElementById("add-site-form");
  const siteInput = document.getElementById("site-input");
  const addButton = document.getElementById("add-site");
  const siteError = document.getElementById("site-error");
  const announcer = document.getElementById("status-announcer");
  const bypassEl = document.getElementById("bypass-cache");

  sentMessages.length = 0;

  /* 1. Empty submit sets accessible error state, focuses #site-input, and announces after 500ms */
  bypassEl.focus();
  siteInput.value = "";
  addForm.submit();

  assert.equal(sentMessages.filter((m) => m.method === "addSite").length, 0);
  assert.equal(addButton.disabled, false);
  assert.equal(siteInput.getAttribute("aria-invalid"), "true");
  assert.equal(siteInput.getAttribute("aria-describedby"), "site-error");
  assert.equal(siteError.hidden, false);
  assert.equal(siteError.textContent, "Error: Enter a valid URL or host (e.g. example.com or https://m.example.com).");
  assert.equal(document.activeElement, siteInput);
  assert.equal(announcer.textContent, "");
  assert.equal(timers.pendingCount(), 1);

  timers.tick(499);
  assert.equal(announcer.textContent, "");
  timers.tick(1);
  assert.equal(announcer.textContent, siteError.textContent);
  assert.equal(timers.pendingCount(), 0);
  assert.deepEqual(state.storage.sites, ["naver.com"]);

  /* 2. Whitespace submit + input event immediately clears error state and pending announcer timer */
  bypassEl.focus();
  siteInput.value = "   \t\n ";
  addForm.submit();

  assert.equal(sentMessages.filter((m) => m.method === "addSite").length, 0);
  assert.equal(siteInput.getAttribute("aria-invalid"), "true");
  assert.equal(siteInput.getAttribute("aria-describedby"), "site-error");
  assert.equal(siteError.hidden, false);
  assert.equal(document.activeElement, siteInput);
  assert.equal(announcer.textContent, "");
  assert.equal(timers.pendingCount(), 1);

  timers.tick(250);
  assert.equal(announcer.textContent, "");
  siteInput.value = "d";
  siteInput.input();

  assert.equal(siteInput.getAttribute("aria-invalid"), "false");
  assert.equal(siteInput.getAttribute("aria-describedby"), null);
  assert.equal(siteError.hidden, true);
  assert.equal(siteError.textContent, "");
  assert.equal(announcer.textContent, "");
  assert.equal(timers.pendingCount(), 0);
  timers.tick(500);
  assert.equal(announcer.textContent, "");

  /* 3. Invalid URL/host ("javascript:alert(1)") */
  bypassEl.focus();
  siteInput.value = "javascript:alert(1)";
  addForm.submit();
  await settle();
  assert.equal(announcer.textContent, "");
  timers.tick(500);

  assert.equal(siteInput.getAttribute("aria-invalid"), "true");
  assert.equal(siteInput.getAttribute("aria-describedby"), "site-error");
  assert.equal(siteError.hidden, false);
  assert.equal(siteError.textContent, "Error: Enter a valid URL or host (e.g. example.com or https://m.example.com).");
  assert.equal(announcer.textContent, siteError.textContent);
  assert.equal(document.activeElement, siteInput);
  assert.deepEqual(state.storage.sites, ["naver.com"]);
  assert.equal(timers.pendingCount(), 0);

  /* 4. Exact duplicate ("naver.com") */
  siteInput.value = "naver.com";
  addForm.submit();
  await settle();
  timers.tick(500);

  assert.equal(siteInput.getAttribute("aria-invalid"), "true");
  assert.equal(siteInput.getAttribute("aria-describedby"), "site-error");
  assert.equal(siteError.hidden, false);
  assert.equal(siteError.textContent, "Error: naver.com is already in the list.");
  assert.equal(announcer.textContent, siteError.textContent);
  assert.equal(document.activeElement, siteInput);
  assert.deepEqual(state.storage.sites, ["naver.com"]);
  assert.equal(timers.pendingCount(), 0);

  /* 5. Covered subdomain ("blog.naver.com" when "naver.com" active) */
  siteInput.value = "blog.naver.com";
  addForm.submit();
  await settle();
  timers.tick(500);

  assert.equal(siteInput.getAttribute("aria-invalid"), "true");
  assert.equal(siteInput.getAttribute("aria-describedby"), "site-error");
  assert.equal(siteError.hidden, false);
  assert.match(siteError.textContent, /covered by naver\.com/);
  assert.equal(siteError.textContent, "Error: blog.naver.com is already covered by naver.com.");
  assert.equal(announcer.textContent, siteError.textContent);
  assert.equal(document.activeElement, siteInput);
  assert.deepEqual(state.storage.sites, ["naver.com"]);
  assert.equal(timers.pendingCount(), 0);

  /* 6. Storage/apply failure */
  state.storageWriteError = {message: "QuotaExceeded"};
  siteInput.value = "daum.net";
  addForm.submit();
  await settle();
  timers.tick(500);
  state.storageWriteError = null;

  assert.equal(addButton.disabled, false);
  assert.equal(siteInput.getAttribute("aria-invalid"), "true");
  assert.equal(siteInput.getAttribute("aria-describedby"), "site-error");
  assert.equal(siteError.hidden, false);
  assert.match(siteError.textContent, /Could not add site\./);
  assert.equal(siteError.textContent, "Error: Could not add site.");
  assert.equal(announcer.textContent, "Error: Could not add site.");
  assert.equal(document.activeElement, siteInput);
  assert.deepEqual(state.storage.sites, ["naver.com"]);
  assert.equal(timers.pendingCount(), 0);
});

test("site add form guards against double submit while in flight and IME composition", async (t) => {
  const sentMessages = [];
  const heldAddSite = [];
  let holdNextAddSite = false;

  const {state, document, pendingTimers} = await loadOptions({}, {
    t,
    sentMessages,
    setupChrome(chromeObj) {
      const origSendMessage = chromeObj.runtime.sendMessage.bind(chromeObj.runtime);
      chromeObj.runtime.sendMessage = (message, optionsOrCallback, maybeCallback, sender) => {
        if (holdNextAddSite && message && message.path === "options-to-background" && message.method === "addSite") {
          holdNextAddSite = false;
          return new Promise((resolve) => {
            heldAddSite.push(() => origSendMessage(message, optionsOrCallback, maybeCallback, sender).then(resolve));
          });
        }
        return origSendMessage(message, optionsOrCallback, maybeCallback, sender);
      };
    }
  });
  const addForm = document.getElementById("add-site-form");
  const siteInput = document.getElementById("site-input");
  const addButton = document.getElementById("add-site");
  const announcer = document.getElementById("status-announcer");

  /* 1. Double-submit guard while addSite response is deferred */
  sentMessages.length = 0;
  holdNextAddSite = true;
  siteInput.focus();
  siteInput.value = "daum.net";

  const firstSubmit = addForm.submit();
  assert.equal(firstSubmit.defaultPrevented, true);
  assert.equal(addButton.disabled, true);
  assert.equal(sentMessages.filter((m) => m.method === "addSite").length, 1);
  assert.equal(heldAddSite.length, 1);

  const secondSubmit = addForm.submit();
  assert.equal(secondSubmit.defaultPrevented, true);
  assert.equal(addButton.disabled, true);
  assert.equal(sentMessages.filter((m) => m.method === "addSite").length, 1);
  assert.equal(heldAddSite.length, 1);

  await settle();
  assert.equal(addButton.disabled, true);
  assert.equal(sentMessages.filter((m) => m.method === "addSite").length, 1);

  await heldAddSite.shift()();
  await settle();

  assert.equal(addButton.disabled, false);
  assert.equal(siteInput.value, "");
  assert.deepEqual(state.storage.sites, ["daum.net"]);
  assert.equal(announcer.textContent, "Added daum.net.");

  /* 2. IME composition guard between compositionstart and compositionend */
  sentMessages.length = 0;
  siteInput.focus();
  siteInput.dispatch("compositionstart");
  siteInput.value = "naver.com";

  const composingSubmit = addForm.submit();
  assert.equal(composingSubmit.defaultPrevented, true);
  await settle();

  assert.equal(addButton.disabled, false);
  assert.equal(sentMessages.filter((m) => m.method === "addSite").length, 0);
  assert.deepEqual(state.storage.sites, ["daum.net"]);
  assert.equal(siteInput.value, "naver.com");
  assert.equal(siteInput.getAttribute("aria-invalid"), "false");

  siteInput.dispatch("compositionend");
  const afterSubmit = addForm.submit();
  assert.equal(afterSubmit.defaultPrevented, true);
  await settle();

  assert.equal(addButton.disabled, false);
  assert.equal(sentMessages.filter((m) => m.method === "addSite").length, 1);
  assert.equal(siteInput.value, "");
  assert.deepEqual(state.storage.sites, ["daum.net", "naver.com"]);
  assert.equal(document.getElementById("sites").children.length, 2);
  assert.equal(announcer.textContent, "Added naver.com.");
  assert.equal(pendingTimers.size, 0);
});
