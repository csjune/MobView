const test = require("node:test");
const assert = require("node:assert/strict");
const {loadBackground, settle} = require("./harness");

function fromOptions(chrome, method, data) {
  chrome.runtime.onMessage.fire({"path": "options-to-background", method, data});
}

function lastToOptions(state, method) {
  return state.toOptions.filter((message) => message.method === method).pop();
}

test("getBaseDomain groups subdomains under the site", () => {
  const {context} = loadBackground();
  const cases = {
    "www.naver.com": "naver.com",
    "m.naver.com": "naver.com",
    "www.xxx.or.kr": "xxx.or.kr",
    "news.bbc.co.uk": "bbc.co.uk",
    "sub.example.ac.jp": "example.ac.jp",
    "foo.github.io": "foo.github.io",
    "a.b.foo.github.io": "foo.github.io",
    "blog.tistory.com": "blog.tistory.com",
    "localhost": "localhost",
    "192.168.0.1": "192.168.0.1",
    "example.com": "example.com"
  };
  for (const [hostname, expected] of Object.entries(cases)) {
    assert.equal(context.core.getBaseDomain(hostname), expected, hostname);
  }
  assert.equal(context.core.getBaseDomain(""), null);
});

test("getSite only accepts http(s) URLs", () => {
  const {context} = loadBackground();
  assert.equal(context.core.getSite("https://m.naver.com/x"), "naver.com");
  assert.equal(context.core.getSite("about:addons"), null);
  assert.equal(context.core.getSite("file:///C:/a.html"), null);
  assert.equal(context.core.getSite("not a url"), null);
});

test("toolbar button toggles mobile view for the current site", async () => {
  const tabs = [{id: 1, url: "https://m.naver.com/x"}, {id: 2, url: "https://news.naver.com/"}, {id: 3, url: "https://daum.net/"}];
  const {chrome, state} = loadBackground({tabs});
  await settle();

  chrome.action.onClicked.fire();
  await settle();
  assert.deepEqual(state.storage.sites, ["naver.com"]);
  assert.equal(state.rules.length, 2);
  assert.deepEqual(state.rules.map((rule) => rule.id), [1, 2]);
  assert.deepEqual(state.rules[0].condition.requestDomains, ["naver.com"]);
  assert.deepEqual(state.rules[1].condition.initiatorDomains, ["naver.com"]);
  assert.ok(!state.rules[1].condition.resourceTypes.includes("sub_frame"));
  assert.deepEqual(state.scripts.map((script) => script.id), ["mobview-storage", "mobview-script"]);
  assert.deepEqual(state.scripts[0].matches, ["*://naver.com/*", "*://*.naver.com/*"]);
  assert.deepEqual(state.icons, {1: "ON", 2: "ON", 3: "OFF"});
  assert.deepEqual(lastToOptions(state, "sites").data, ["naver.com"]);
  assert.deepEqual(state.reloads.pop(), {tabId: 1, bypassCache: true});

  chrome.action.onClicked.fire();
  await settle();
  assert.deepEqual(state.storage.sites, []);
  assert.equal(state.rules.length, 0);
  assert.equal(state.scripts.length, 0);
  assert.deepEqual(state.icons, {1: "OFF", 2: "OFF", 3: "OFF"});
  /* no m. -> desktop redirect, just a reload */
  assert.deepEqual(state.reloads.pop(), {tabId: 1, bypassCache: true});
});

test("rapid clicks are processed in order", async () => {
  const {chrome, state} = loadBackground({tabs: [{id: 1, url: "https://www.daum.net/"}]});
  await settle();
  chrome.action.onClicked.fire();
  chrome.action.onClicked.fire();
  chrome.action.onClicked.fire();
  await settle(50);
  assert.deepEqual(state.storage.sites, ["daum.net"]);
  assert.equal(state.rules.length, 2);
  assert.equal(state.reloads.length, 3);
});

test("button does nothing on non-web pages", async () => {
  const {chrome, state} = loadBackground({tabs: [{id: 1, url: "about:addons"}]});
  await settle();
  chrome.action.onClicked.fire();
  await settle();
  assert.equal(state.storage.sites, undefined);
  assert.equal(state.reloads.length, 0);
});

test("options: user-agent change is applied to the rules immediately", async () => {
  const {chrome, state} = loadBackground({tabs: [], storage: {sites: ["naver.com"]}});
  await settle();
  fromOptions(chrome, "useragent", {useragent: "UA2"});
  await settle();
  assert.equal(state.storage.useragent, "UA2");
  assert.equal(state.rules[0].action.requestHeaders[0].value, "UA2");
});

test("options: an empty user-agent falls back to the default", async () => {
  const {chrome, state, context} = loadBackground({tabs: [], storage: {sites: ["naver.com"], useragent: "UA2"}});
  await settle();
  fromOptions(chrome, "useragent", {useragent: "   "});
  await settle();
  assert.equal("useragent" in state.storage, false);
  assert.equal(state.rules.length, 2);
  assert.equal(state.rules[0].action.requestHeaders[0].value, context.defaults.useragent);
  assert.equal(state.scripts.length, 2);
  /* the options page is told about the default so the text area shows it again */
  assert.equal(lastToOptions(state, "settings").data.useragent, context.defaults.useragent);
});

test("options: removeSite and bypassCache", async () => {
  const {chrome, state} = loadBackground({tabs: [{id: 1, url: "https://naver.com/"}], storage: {sites: ["naver.com", "daum.net"]}});
  await settle();

  fromOptions(chrome, "removeSite", {site: "naver.com"});
  await settle();
  assert.deepEqual(state.storage.sites, ["daum.net"]);
  assert.deepEqual(state.rules[0].condition.requestDomains, ["daum.net"]);
  assert.equal(state.icons[1], "OFF");

  fromOptions(chrome, "bypassCache", {bypassCache: false});
  await settle();
  assert.equal(state.storage.bypassCache, false);
});

test("options: load sends settings and sites", async () => {
  const {chrome, state, context} = loadBackground({storage: {sites: ["naver.com"]}});
  await settle();
  fromOptions(chrome, "load");
  await settle();
  assert.deepEqual(lastToOptions(state, "settings").data, {bypassCache: true, useragent: context.defaults.useragent});
  assert.deepEqual(lastToOptions(state, "sites").data, ["naver.com"]);
});

test("startup registers rules and the context menu without duplicate errors", async () => {
  const {chrome, state} = loadBackground({storage: {sites: ["naver.com"]}});
  await settle();
  chrome.runtime.onInstalled.fire({});
  chrome.runtime.onStartup.fire();
  await settle();
  assert.equal(state.rules.length, 2);
  assert.deepEqual(state.menus.map((menu) => menu.id), ["mobview"]);
  chrome.contextMenus.onClicked.fire({}, {});
  await settle();
  assert.equal(state.opened.length, 1);
});

test("tab events update the icon only when the page changes", async () => {
  const tabs = [{id: 1, url: "https://naver.com/"}];
  const {chrome, state} = loadBackground({tabs, storage: {sites: ["naver.com"]}});
  await settle();
  chrome.tabs.onUpdated.fire(1, {title: "x"}, tabs[0]);
  await settle();
  assert.equal(state.icons[1], undefined);
  chrome.tabs.onUpdated.fire(1, {status: "loading"}, tabs[0]);
  await settle();
  assert.equal(state.icons[1], "ON");
  chrome.tabs.onActivated.fire({tabId: 1});
  await settle();
  assert.equal(state.icons[1], "ON");
});
