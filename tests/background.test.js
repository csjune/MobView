const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {loadBackground, reloadBackground, fakeStorage, settle} = require("./harness");
const {buildChrome, chromeDefaults} = require("../scripts/build-chrome");

function buildChromeTemp(t) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "mobview-chrome-"));
  t.after(() => fs.rmSync(outputDir, {recursive: true, force: true}));
  return buildChrome({outputDir, artifactsDir: null});
}

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
    "www.ad.nl": "ad.nl",
    "www.lg.de": "lg.de",
    "www.hs.fi": "hs.fi",
    "www.ed.nl": "ed.nl",
    "www.gr.ch": "gr.ch",
    "www.city.kobe.lg.jp": "kobe.lg.jp",
    "www.seoul.hs.kr": "seoul.hs.kr",
    "www.xxx.or.kr": "xxx.or.kr",
    "news.bbc.co.uk": "bbc.co.uk",
    "www.niwa.cri.nz": "niwa.cri.nz",
    "www.ori.nz": "ori.nz",
    "www.nhs.uk": "www.nhs.uk",
    "www.trust.nhs.uk": "trust.nhs.uk",
    "www.gov.uk": "www.gov.uk",
    "www.cabinetoffice.gov.uk": "cabinetoffice.gov.uk",
    "sub.example.ac.jp": "example.ac.jp",
    "foo.github.io": "foo.github.io",
    "a.b.foo.github.io": "foo.github.io",
    "blog.tistory.com": "blog.tistory.com",
    "localhost": "localhost",
    "192.168.0.1": "192.168.0.1",
    "[::1]": "[::1]",
    "[2001:0DB8::1]": "[2001:db8::1]",
    "www.example.com.": "example.com",
    "example.com": "example.com"
  };
  for (const [hostname, expected] of Object.entries(cases)) {
    assert.equal(context.core.getBaseDomain(hostname), expected, hostname);
  }
  assert.equal(context.core.getBaseDomain(""), null);
  assert.equal(context.core.getBaseDomain("."), null);
});

test("getSite only accepts http(s) URLs", () => {
  const {context} = loadBackground();
  assert.equal(context.core.getSite("https://m.naver.com/x"), "naver.com");
  assert.equal(context.core.getSite("http://[::1]:8080/"), "[::1]");
  assert.equal(context.core.getSite("http://[2001:0DB8::1]/"), "[2001:db8::1]");
  assert.equal(context.core.getSite("https://www.example.com./path"), "example.com");
  assert.equal(context.core.getSite("https://./"), null);
  assert.equal(context.core.getSite("about:addons"), null);
  assert.equal(context.core.getSite("file:///C:/a.html"), null);
  assert.equal(context.core.getSite("not a url"), null);
});

test("toolbar button toggles mobile view for the current site", async () => {
  const tabs = [{id: 1, url: "https://m.naver.com/x"}, {id: 2, url: "https://news.naver.com/"}, {id: 3, url: "https://daum.net/"}];
  const {chrome, state, context} = loadBackground({tabs});
  await settle();

  let executedBeforeReload = null;
  const origReload = chrome.tabs.reload;
  chrome.tabs.reload = (tabId, opts) => {
    executedBeforeReload = structuredClone(state.executedScripts);
    origReload(tabId, opts);
  };

  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();
  assert.deepEqual(state.storage.sites, ["naver.com"]);
  assert.equal(state.rules.length, 3);
  assert.deepEqual(state.rules.map((rule) => rule.id), [1, 2, 3]);
  assert.deepEqual(state.rules[0].condition.requestDomains, ["naver.com"]);
  assert.deepEqual(state.rules[0].condition.resourceTypes, ["main_frame"]);
  assert.deepEqual(state.rules[1].condition.requestDomains, ["naver.com"]);
  assert.deepEqual(state.rules[1].condition.initiatorDomains, ["naver.com"]);
  assert.deepEqual(state.rules[1].condition.resourceTypes, ["sub_frame"]);
  assert.deepEqual(state.rules[2].condition.initiatorDomains, ["naver.com"]);
  assert.deepEqual(state.rules[2].condition.excludedResourceTypes, ["main_frame", "sub_frame"]);
  assert.equal("resourceTypes" in state.rules[2].condition, false);
  assert.deepEqual(state.scripts.map((script) => script.id), ["mobview-storage", "mobview-script"]);
  assert.deepEqual(state.scripts[0].matches, ["*://naver.com/*", "*://*.naver.com/*"]);
  assert.deepEqual(state.icons, {1: "ON", 2: "ON", 3: "OFF"});
  assert.deepEqual(lastToOptions(state, "sites").data, ["naver.com"]);
  assert.deepEqual(executedBeforeReload, [
    {target: {tabId: 1, allFrames: true}, hasFunc: true, args: [context.defaults.useragent, ["naver.com"]]},
    {target: {tabId: 2, allFrames: true}, hasFunc: true, args: [context.defaults.useragent, ["naver.com"]]}
  ]);
  assert.deepEqual(state.executedScripts, [
    {target: {tabId: 1, allFrames: true}, hasFunc: true, args: [context.defaults.useragent, ["naver.com"]]},
    {target: {tabId: 2, allFrames: true}, hasFunc: true, args: [context.defaults.useragent, ["naver.com"]]}
  ]);
  assert.deepEqual(state.reloads.pop(), {tabId: 1, bypassCache: true});

  state.executedScripts.length = 0;
  executedBeforeReload = null;

  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();
  assert.deepEqual(state.storage.sites, []);
  assert.equal(state.rules.length, 0);
  assert.equal(state.scripts.length, 0);
  assert.deepEqual(state.icons, {1: "OFF", 2: "OFF", 3: "OFF"});
  assert.deepEqual(state.executedScripts, [
    {target: {tabId: 1, allFrames: true}, hasFunc: true},
    {target: {tabId: 2, allFrames: true}, hasFunc: true}
  ]);
  /* no m. -> desktop redirect, just a reload */
  assert.deepEqual(state.reloads.pop(), {tabId: 1, bypassCache: true});
});

test("adding a second site updates content scripts in place without unregistering", async () => {
  const tabs = [{id: 1, url: "https://m.naver.com/x"}, {id: 2, url: "https://www.daum.net/"}];
  const {chrome, state} = loadBackground({tabs});
  await settle();

  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();
  assert.deepEqual(state.scriptingCalls, ["get", "register", "execute"]);

  state.scriptingCalls.length = 0;
  chrome.action.onClicked.fire(state.tabs[1]);
  await settle();

  assert.deepEqual(state.storage.sites, ["naver.com", "daum.net"]);
  assert.ok(state.scriptingCalls.includes("get"));
  assert.ok(state.scriptingCalls.includes("update"));
  assert.equal(state.scriptingCalls.includes("unregister"), false);
  assert.equal(state.scriptingCalls.includes("register"), false);
  assert.deepEqual(state.scripts.map((script) => script.id), ["mobview-storage", "mobview-script"]);
  assert.deepEqual(state.scripts[0].matches, [
    "*://naver.com/*", "*://*.naver.com/*",
    "*://daum.net/*", "*://*.daum.net/*"
  ]);
});

test("rapid clicks are processed in order", async () => {
  const {chrome, state} = loadBackground({tabs: [{id: 1, url: "https://www.daum.net/"}]});
  await settle();
  chrome.action.onClicked.fire(state.tabs[0]);
  chrome.action.onClicked.fire(state.tabs[0]);
  chrome.action.onClicked.fire(state.tabs[0]);
  await settle(50);
  assert.deepEqual(state.storage.sites, ["daum.net"]);
  assert.equal(state.rules.length, 3);
  assert.equal(state.reloads.length, 3);
});

test("button does nothing on non-web pages", async () => {
  const {chrome, state} = loadBackground({tabs: [{id: 1, url: "about:addons"}]});
  await settle();
  chrome.action.onClicked.fire(state.tabs[0]);
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
  assert.equal(state.rules.length, 3);
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
  assert.deepEqual(state.executedScripts, [{target: {tabId: 1, allFrames: true}, hasFunc: true}]);

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

test("firefox skips registration on bare wake-up and registers scripts, rules, and icons on onInstalled and onStartup", async () => {
  const tabs = [{id: 1, url: "https://naver.com/"}, {id: 2, url: "https://daum.net/"}];

  const installed = loadBackground({tabs, storage: {sites: ["naver.com"]}});
  await settle();
  assert.equal(installed.state.scriptingCalls.length, 0);
  assert.equal(installed.state.scripts.length, 0);
  assert.equal(installed.state.rules.length, 0);

  installed.chrome.runtime.onInstalled.fire({reason: "install"});
  await settle();
  assert.equal(installed.state.rules.length, 3);
  assert.deepEqual(installed.state.scripts.map((script) => script.id), ["mobview-storage", "mobview-script"]);
  assert.deepEqual(installed.state.icons, {1: "ON", 2: "OFF"});

  const startup = loadBackground({tabs, storage: {sites: ["naver.com"]}});
  await settle();
  assert.equal(startup.state.scriptingCalls.length, 0);
  startup.chrome.runtime.onStartup.fire();
  await settle();
  assert.equal(startup.state.rules.length, 3);
  assert.deepEqual(startup.state.scripts.map((script) => script.id), ["mobview-storage", "mobview-script"]);
  assert.deepEqual(startup.state.icons, {1: "ON", 2: "OFF"});
});

test("storage.local.get lastError preserves existing sites and recovers on the next event", async () => {
  const tabs = [{id: 1, url: "https://www.daum.net/"}];
  const {chrome, state} = loadBackground({tabs, storage: {sites: ["naver.com"]}});
  state.storageGetError = {message: "disk error"};

  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();
  assert.deepEqual(state.storage.sites, ["naver.com"]);
  assert.equal(state.rules.length, 0);
  assert.equal(state.reloads.length, 0);

  state.storageGetError = null;
  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();
  assert.deepEqual(state.storage.sites, ["naver.com", "daum.net"]);
  assert.equal(state.rules.length, 3);
  assert.equal(state.icons[1], "ON");
  assert.deepEqual(state.reloads.pop(), {tabId: 1, bypassCache: true});
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

test("chrome service worker loads via importScripts and onInstalled registers scripts, rules, and icons", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const tabs = [{id: 1, url: "https://naver.com/"}, {id: 2, url: "https://daum.net/"}];
  const {chrome, state, context} = loadBackground({dir: outputDir, tabs, storage: {sites: ["naver.com"]}});
  await settle();
  assert.equal(context.app.backgroundWorker, true);
  assert.equal(state.scripts.length, 0);
  assert.equal(state.rules.length, 0);

  chrome.runtime.onInstalled.fire({reason: "install"});
  await settle();

  assert.deepEqual(state.scripts.map((script) => script.id), ["mobview-storage", "mobview-script"]);
  assert.equal(state.rules.length, 6);
  assert.deepEqual(state.icons, {1: "ON", 2: "OFF"});
});

test("chrome DNR rules set Chrome default user-agent with aligned Client Hints on HTTPS and strip all hints on HTTP or non-Chromium UA", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {chrome, state} = loadBackground({dir: outputDir, storage: {sites: ["naver.com"]}});
  chrome.runtime.onInstalled.fire({reason: "install"});
  await settle();

  const highEntropyHints = [
    "sec-ch-ua-arch", "sec-ch-ua-bitness", "sec-ch-ua-form-factors", "sec-ch-ua-full-version",
    "sec-ch-ua-full-version-list", "sec-ch-ua-model", "sec-ch-ua-platform-version", "sec-ch-ua-wow64"
  ];
  const allHints = ["sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", ...highEntropyHints];
  const expectedHttpsHeaders = [
    {operation: "set", header: "user-agent", value: chromeDefaults.useragent},
    {operation: "set", header: "sec-ch-ua", value: '"Not/A)Brand";v="8", "Chromium";v="157", "Google Chrome";v="157"'},
    {operation: "set", header: "sec-ch-ua-mobile", value: "?1"},
    {operation: "set", header: "sec-ch-ua-platform", value: '"Android"'},
    ...highEntropyHints.map((header) => ({operation: "remove", header}))
  ];
  const expectedHttpHeaders = [
    {operation: "set", header: "user-agent", value: chromeDefaults.useragent},
    ...allHints.map((header) => ({operation: "remove", header}))
  ];

  assert.equal(state.rules.length, 6);
  assert.deepEqual(state.rules.map((rule) => rule.id), [1, 2, 3, 4, 5, 6]);
  for (const [index, urlFilter] of [
    [0, "|https://"],
    [1, "|https://"],
    [2, "|https://"],
    [3, "|http://"],
    [4, "|http://"],
    [5, "|http://"]
  ]) {
    const rule = state.rules[index];
    assert.equal(rule.action.type, "modifyHeaders");
    assert.equal(rule.condition.urlFilter, urlFilter);
    assert.deepEqual(
      rule.action.requestHeaders,
      urlFilter === "|https://" ? expectedHttpsHeaders : expectedHttpHeaders
    );
  }
  assert.deepEqual(state.rules[0].condition.resourceTypes, ["main_frame"]);
  assert.deepEqual(state.rules[1].condition.resourceTypes, ["sub_frame"]);
  assert.deepEqual(state.rules[2].condition.excludedResourceTypes, ["main_frame", "sub_frame"]);
  assert.deepEqual(state.rules[3].condition.resourceTypes, ["main_frame"]);
  assert.deepEqual(state.rules[4].condition.resourceTypes, ["sub_frame"]);
  assert.deepEqual(state.rules[5].condition.excludedResourceTypes, ["main_frame", "sub_frame"]);

  const iphoneUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
  fromOptions(chrome, "useragent", {useragent: iphoneUA});
  await settle();

  assert.equal(state.rules.length, 3);
  assert.deepEqual(state.rules.map((rule) => rule.id), [1, 2, 3]);
  const expectedCustomHeaders = [
    {operation: "set", header: "user-agent", value: iphoneUA},
    ...allHints.map((header) => ({operation: "remove", header}))
  ];
  for (const rule of state.rules) {
    assert.equal(rule.action.type, "modifyHeaders");
    assert.equal("urlFilter" in rule.condition, false);
    assert.deepEqual(rule.action.requestHeaders, expectedCustomHeaders);
  }
});

test("registerContentScripts and DNR handle IPv6, IPv4, and localhost without wildcard subdomain patterns", async () => {
  const cases = [
    {url: "http://[::1]:8080/", site: "[::1]", matches: ["*://[::1]/*"]},
    {url: "http://[2001:0DB8::1]/", site: "[2001:db8::1]", matches: ["*://[2001:db8::1]/*"]},
    {url: "http://192.168.0.1/", site: "192.168.0.1", matches: ["*://192.168.0.1/*"]},
    {url: "http://localhost:3000/", site: "localhost", matches: ["*://localhost/*"]}
  ];
  for (const {url, site, matches} of cases) {
    const {chrome, state} = loadBackground({tabs: [{id: 1, url}]});
    await settle();
    chrome.action.onClicked.fire(state.tabs[0]);
    await settle();
    assert.deepEqual(state.storage.sites, [site], url);
    assert.deepEqual(state.scripts[0].matches, matches, url);
    assert.deepEqual(state.scripts[1].matches, matches, url);
    assert.deepEqual(state.rules[0].condition.requestDomains, [site], url);
    assert.deepEqual(state.rules[1].condition.initiatorDomains, [site], url);
  }
});

test("shared-hosting root toggle applies to subdomains and disables idempotently from a subdomain tab", async () => {
  const tabs = [
    {id: 1, url: "https://tistory.com/"},
    {id: 2, url: "https://myblog.tistory.com/post"}
  ];
  const {chrome, state, context} = loadBackground({tabs});
  await settle();

  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();
  assert.deepEqual(state.storage.sites, ["tistory.com"]);
  assert.deepEqual(state.icons, {1: "ON", 2: "ON"});
  assert.equal(context.core.isEnabled("https://myblog.tistory.com/post"), true);

  state.executedScripts.length = 0;

  chrome.action.onClicked.fire(state.tabs[1]);
  await settle();
  assert.deepEqual(state.storage.sites, []);
  assert.deepEqual(state.executedScripts, [
    {target: {tabId: 1, allFrames: true}, hasFunc: true},
    {target: {tabId: 2, allFrames: true}, hasFunc: true}
  ]);
  assert.deepEqual(state.icons, {1: "OFF", 2: "OFF"});
  assert.equal(state.rules.length, 0);
  assert.equal(state.scripts.length, 0);
  assert.equal(context.core.isEnabled("https://myblog.tistory.com/post"), false);
});

test("options: multiline user-agent is normalized, applied to rules, and synced to enabled tabs only", async () => {
  const tabs = [
    {id: 1, url: "https://m.naver.com/"},
    {id: 2, url: "https://daum.net/"}
  ];
  const {chrome, state} = loadBackground({tabs, storage: {sites: ["naver.com"]}});
  await settle();

  fromOptions(chrome, "useragent", {useragent: "Mozilla/5.0\r\n(Android 15)\tMobile"});
  await settle();

  assert.equal(state.storage.useragent, "Mozilla/5.0 (Android 15) Mobile");
  assert.equal(state.rules[0].action.requestHeaders[0].value, "Mozilla/5.0 (Android 15) Mobile");
  assert.deepEqual(state.executedScripts, [
    {target: {tabId: 1, allFrames: true}, hasFunc: true, args: ["Mozilla/5.0 (Android 15) Mobile", ["naver.com"]]}
  ]);
  assert.equal(lastToOptions(state, "settings").data.useragent, "Mozilla/5.0 (Android 15) Mobile");
});

test("options: non-ASCII or control-char user-agent is rejected without breaking storage, rules, or subsequent toggles", async () => {
  const tabs = [{id: 1, url: "https://www.daum.net/"}];
  const {chrome, state} = loadBackground({tabs, storage: {sites: ["naver.com"], useragent: "Valid-UA/1.0"}});
  chrome.runtime.onInstalled.fire({reason: "install"});
  await settle();

  for (const invalid of ["Mozilla/5.0 한글", "Bad\x00UA"]) {
    state.toOptions.length = 0;
    fromOptions(chrome, "useragent", {useragent: invalid});
    await settle();

    assert.equal(state.storage.useragent, "Valid-UA/1.0");
    assert.equal(state.rules[0].action.requestHeaders[0].value, "Valid-UA/1.0");
    assert.ok(lastToOptions(state, "useragentInvalid"));
  }

  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();
  assert.deepEqual(state.storage.sites, ["naver.com", "daum.net"]);
  assert.equal(state.rules.length, 3);
  assert.equal(state.rules[0].action.requestHeaders[0].value, "Valid-UA/1.0");
  assert.equal(state.icons[1], "ON");
  assert.deepEqual(state.reloads.pop(), {tabId: 1, bypassCache: true});
});

test("enabling a site pre-populates tab sessionStorage with custom stored user-agent before reload", async () => {
  const tabs = [{id: 1, url: "https://m.naver.com/x"}];
  const {chrome, state} = loadBackground({tabs, storage: {useragent: "Custom-Mobile/2.0"}});
  await settle();

  let executedBeforeReload = null;
  const origReload = chrome.tabs.reload;
  chrome.tabs.reload = (tabId, opts) => {
    executedBeforeReload = structuredClone(state.executedScripts);
    origReload(tabId, opts);
  };

  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();

  assert.deepEqual(executedBeforeReload, [
    {target: {tabId: 1, allFrames: true}, hasFunc: true, args: ["Custom-Mobile/2.0", ["naver.com"]]}
  ]);
  assert.deepEqual(state.executedScripts, [
    {target: {tabId: 1, allFrames: true}, hasFunc: true, args: ["Custom-Mobile/2.0", ["naver.com"]]}
  ]);
  assert.deepEqual(state.reloads, [{tabId: 1, bypassCache: true}]);
});

test("setTabStorage sets enabled frame sessionStorage and purges localStorage without polluting third-party iframes", async () => {
  const mainFrame = {
    hostname: "m.naver.com",
    sessionStorage: fakeStorage(),
    localStorage: fakeStorage({"mobview-useragent": "Stale-Local"})
  };
  const thirdPartyFrame = {
    hostname: "accounts.google.com",
    sessionStorage: fakeStorage({"existing": "keep"}),
    localStorage: fakeStorage({"mobview-useragent": "Untouched-Third-Party"})
  };
  const tabs = [{id: 1, url: "https://m.naver.com/", frames: [mainFrame, thirdPartyFrame]}];
  const {chrome, state, context} = loadBackground({tabs});
  await settle();

  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();

  assert.equal(mainFrame.sessionStorage.items["mobview-useragent"], context.defaults.useragent);
  assert.equal("mobview-useragent" in mainFrame.localStorage.items, false);
  assert.equal("mobview-useragent" in thirdPartyFrame.sessionStorage.items, false);
  assert.equal(thirdPartyFrame.sessionStorage.items.existing, "keep");
  assert.equal(thirdPartyFrame.localStorage.items["mobview-useragent"], "Untouched-Third-Party");

  fromOptions(chrome, "useragent", {useragent: "Custom-Mobile/2.0"});
  await settle();

  assert.equal(mainFrame.sessionStorage.items["mobview-useragent"], "Custom-Mobile/2.0");
  assert.equal("mobview-useragent" in thirdPartyFrame.sessionStorage.items, false);
  assert.equal(thirdPartyFrame.localStorage.items["mobview-useragent"], "Untouched-Third-Party");
});

test("updateTabsStorage bounds hanging executeScript calls, skips discarded tabs, and keeps queue unblocked", async () => {
  const tabs = [
    {id: 1, url: "https://m.naver.com/"},
    {id: 2, url: "https://news.naver.com/", hangExecute: true},
    {id: 3, url: "https://blog.naver.com/", discarded: true}
  ];
  const {chrome, state, context} = loadBackground({tabs});
  await settle();
  context.core.storageSyncTimeout = 40;

  const started = Date.now();
  await Promise.all(chrome.action.onClicked.fire(state.tabs[0]));
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 350, `expected timeout-bounded reload < 350ms, got ${elapsed}ms`);
  assert.deepEqual(state.storage.sites, ["naver.com"]);
  assert.equal(state.tabs[0].sessionStorage.items["mobview-useragent"], context.defaults.useragent);
  assert.equal(state.executedScripts.some((entry) => entry.target.tabId === 3), false);
  assert.deepEqual(state.reloads, [{tabId: 1, bypassCache: true}]);
  assert.deepEqual(state.icons, {1: "ON", 2: "ON", 3: "ON"});

  await Promise.all(chrome.action.onClicked.fire(state.tabs[0]));
  assert.deepEqual(state.storage.sites, []);
  assert.equal("mobview-useragent" in state.tabs[0].sessionStorage.items, false);
  assert.equal(state.executedScripts.some((entry) => entry.target.tabId === 3), false);
  assert.deepEqual(state.reloads, [{tabId: 1, bypassCache: true}, {tabId: 1, bypassCache: true}]);
  assert.deepEqual(state.icons, {1: "OFF", 2: "OFF", 3: "OFF"});
});

test("button ignores invalid wildcard host URLs without polluting sites", async () => {
  const tabs = [
    {id: 1, url: "http://*/"},
    {id: 2, url: "http://a*b.example.com/"}
  ];
  const {chrome, state} = loadBackground({tabs});
  await settle();

  for (const tab of state.tabs) {
    chrome.action.onClicked.fire(tab);
    await settle();
  }

  assert.equal(state.storage.sites, undefined);
  assert.equal(state.rules.length, 0);
  assert.equal(state.scripts.length, 0);
  assert.equal(state.reloads.length, 0);
});

test("registerContentScripts or updateContentScripts failure rolls back toggle ON and removeSite without wedging future toggles", async () => {
  const toggleTabs = [{id: 1, url: "https://naver.com/"}];
  const toggle = loadBackground({tabs: toggleTabs});
  await settle();

  const origRegister = toggle.chrome.scripting.registerContentScripts;
  let failRegisterOnce = true;
  toggle.chrome.scripting.registerContentScripts = async (scripts) => {
    if (failRegisterOnce) {
      failRegisterOnce = false;
      throw new Error("register failed");
    }
    return origRegister(scripts);
  };

  toggle.chrome.action.onClicked.fire(toggle.state.tabs[0]);
  await settle();
  assert.deepEqual(toggle.state.storage.sites, []);
  assert.equal(toggle.state.rules.length, 0);
  assert.equal(toggle.state.scripts.length, 0);
  assert.equal(toggle.state.icons[1], "OFF");
  assert.equal(toggle.state.reloads.length, 0);

  toggle.chrome.action.onClicked.fire(toggle.state.tabs[0]);
  await settle();
  assert.deepEqual(toggle.state.storage.sites, ["naver.com"]);
  assert.equal(toggle.state.rules.length, 3);
  assert.equal(toggle.state.scripts.length, 2);
  assert.equal(toggle.state.icons[1], "ON");
  assert.deepEqual(toggle.state.reloads, [{tabId: 1, bypassCache: true}]);

  // removeSite rollback when registerContentScripts throws before initial install sync
  const removeCold = loadBackground({
    tabs: [{id: 1, url: "https://naver.com/"}, {id: 2, url: "https://daum.net/"}],
    storage: {sites: ["naver.com", "daum.net"]}
  });
  const origColdRegister = removeCold.chrome.scripting.registerContentScripts;
  let failColdOnce = true;
  removeCold.chrome.scripting.registerContentScripts = async (scripts) => {
    if (failColdOnce) {
      failColdOnce = false;
      throw new Error("register failed on removeSite");
    }
    return origColdRegister(scripts);
  };

  fromOptions(removeCold.chrome, "removeSite", {site: "naver.com"});
  await settle();
  assert.deepEqual(removeCold.state.storage.sites, ["naver.com", "daum.net"]);
  assert.deepEqual(removeCold.state.rules[0].condition.requestDomains, ["naver.com", "daum.net"]);
  assert.equal(removeCold.state.scripts.length, 2);
  assert.deepEqual(removeCold.state.icons, {1: "ON", 2: "ON"});
  assert.equal(removeCold.state.executedScripts.length, 0);

  // removeSite rollback when updateContentScripts throws after install sync
  const removeWarm = loadBackground({
    tabs: [{id: 1, url: "https://naver.com/"}, {id: 2, url: "https://daum.net/"}],
    storage: {sites: ["naver.com", "daum.net"]}
  });
  removeWarm.chrome.runtime.onInstalled.fire({reason: "install"});
  await settle();

  const origUpdate = removeWarm.chrome.scripting.updateContentScripts;
  let failUpdateOnce = true;
  removeWarm.chrome.scripting.updateContentScripts = async (scripts) => {
    if (failUpdateOnce) {
      failUpdateOnce = false;
      throw new Error("update failed on removeSite");
    }
    return origUpdate(scripts);
  };

  fromOptions(removeWarm.chrome, "removeSite", {site: "naver.com"});
  await settle();
  assert.deepEqual(removeWarm.state.storage.sites, ["naver.com", "daum.net"]);
  assert.deepEqual(removeWarm.state.rules[0].condition.requestDomains, ["naver.com", "daum.net"]);
  assert.deepEqual(removeWarm.state.scripts[0].matches, [
    "*://naver.com/*", "*://*.naver.com/*",
    "*://daum.net/*", "*://*.daum.net/*"
  ]);
  assert.deepEqual(removeWarm.state.icons, {1: "ON", 2: "ON"});
  assert.equal(removeWarm.state.executedScripts.length, 0);

  removeWarm.chrome.action.onClicked.fire(removeWarm.state.tabs[0]);
  await settle();
  assert.deepEqual(removeWarm.state.storage.sites, ["daum.net"]);
  assert.deepEqual(removeWarm.state.icons, {1: "OFF", 2: "ON"});
});

test("legacy corrupted sites are sanitized on sync and config.sites handles non-array storage", async () => {
  const legacy = loadBackground({
    tabs: [{id: 1, url: "https://www.ad.nl/"}, {id: 2, url: "https://myblog.tistory.com/"}],
    storage: {
      sites: ["com.", "www.ad.nl", "ad.nl", "myblog.tistory.com", "tistory.com", "http://bad*", 123]
    }
  });
  legacy.chrome.runtime.onInstalled.fire({reason: "install"});
  await settle();

  assert.deepEqual(legacy.state.storage.sites, ["com", "ad.nl", "tistory.com"]);
  assert.deepEqual(legacy.state.rules[0].condition.requestDomains, ["com", "ad.nl", "tistory.com"]);
  assert.deepEqual(legacy.state.scripts[0].matches, [
    "*://com/*",
    "*://ad.nl/*", "*://*.ad.nl/*",
    "*://tistory.com/*", "*://*.tistory.com/*"
  ]);
  assert.deepEqual(legacy.state.icons, {1: "ON", 2: "ON"});

  for (const corrupted of [null, "naver.com", 42, {a: 1}]) {
    const {chrome, context} = loadBackground({storage: {sites: corrupted}});
    fromOptions(chrome, "load");
    await settle();
    assert.deepEqual(structuredClone(context.config.sites), []);
  }
});

test("overlapping sites disable in 1 click and removeSite preserves tabs still covered by remaining rules", async () => {
  const oneClick = loadBackground({
    tabs: [
      {id: 1, url: "https://myblog.tistory.com/"},
      {id: 2, url: "https://other.tistory.com/"}
    ],
    storage: {sites: ["myblog.tistory.com", "tistory.com"]}
  });
  await settle();

  oneClick.chrome.action.onClicked.fire(oneClick.state.tabs[0]);
  await settle();

  assert.deepEqual(oneClick.state.storage.sites, []);
  assert.equal(oneClick.state.rules.length, 0);
  assert.equal(oneClick.state.scripts.length, 0);
  assert.deepEqual(oneClick.state.icons, {1: "OFF", 2: "OFF"});
  assert.deepEqual(oneClick.state.executedScripts, [
    {target: {tabId: 1, allFrames: true}, hasFunc: true},
    {target: {tabId: 2, allFrames: true}, hasFunc: true}
  ]);

  const partial = loadBackground({
    tabs: [
      {id: 1, url: "https://myblog.tistory.com/"},
      {id: 2, url: "https://other.tistory.com/"}
    ],
    storage: {sites: ["myblog.tistory.com", "tistory.com"]}
  });
  fromOptions(partial.chrome, "removeSite", {site: "tistory.com"});
  await settle();

  assert.deepEqual(partial.state.storage.sites, ["myblog.tistory.com"]);
  assert.deepEqual(partial.state.rules[0].condition.requestDomains, ["myblog.tistory.com"]);
  assert.deepEqual(partial.state.icons, {1: "ON", 2: "OFF"});
  assert.deepEqual(partial.state.executedScripts, [
    {target: {tabId: 2, allFrames: true}, hasFunc: true}
  ]);
});

test("storageWriteError rolls back app.storage.local during button and useragent updates", async () => {
  const btn = loadBackground({
    tabs: [{id: 1, url: "https://naver.com/"}],
    storage: {sites: ["daum.net"]}
  });
  btn.chrome.runtime.onInstalled.fire({reason: "install"});
  await settle();

  btn.state.storageWriteError = {message: "quota"};
  btn.chrome.action.onClicked.fire(btn.state.tabs[0]);
  await settle();

  assert.deepEqual(btn.context.app.storage.read("sites"), ["daum.net"]);
  assert.deepEqual(btn.state.storage.sites, ["daum.net"]);
  assert.deepEqual(btn.state.rules[0].condition.requestDomains, ["daum.net"]);
  assert.equal(btn.state.reloads.length, 0);

  btn.state.storageWriteError = null;
  btn.chrome.action.onClicked.fire(btn.state.tabs[0]);
  await settle();
  assert.deepEqual(btn.state.storage.sites, ["daum.net", "naver.com"]);

  const ua = loadBackground({
    tabs: [{id: 1, url: "https://naver.com/"}],
    storage: {sites: ["naver.com"], useragent: "Valid-UA/1.0"}
  });
  ua.chrome.runtime.onInstalled.fire({reason: "install"});
  await settle();

  ua.state.storageWriteError = {message: "quota"};
  fromOptions(ua.chrome, "useragent", {useragent: "Quota-Fail-UA"});
  await settle();

  assert.equal(ua.context.app.storage.read("useragent"), "Valid-UA/1.0");
  assert.equal(ua.state.storage.useragent, "Valid-UA/1.0");
  assert.equal(ua.state.rules[0].action.requestHeaders[0].value, "Valid-UA/1.0");
  assert.deepEqual(lastToOptions(ua.state, "useragentInvalid").data, {
    useragent: "Valid-UA/1.0",
    reason: "apply"
  });
});

test("DNR updateDynamicRules failure rolls back useragent from custom, default, and legacy non-ASCII values", async () => {
  for (const scenario of [
    {name: "custom", initialStorage: {sites: ["naver.com"], useragent: "Valid-UA/1.0"}, expectStored: "Valid-UA/1.0"},
    {name: "default", initialStorage: {sites: ["naver.com"]}, expectStored: undefined},
    {name: "legacy-non-ascii", initialStorage: {sites: ["naver.com"], useragent: "Mozilla/5.0 한글"}, expectStored: undefined}
  ]) {
    const {chrome, state, context} = loadBackground({storage: scenario.initialStorage});
    chrome.runtime.onInstalled.fire({reason: "install"});
    await settle();

    const expectedUA = scenario.expectStored || context.defaults.useragent;
    const origUpdate = chrome.declarativeNetRequest.updateDynamicRules;
    let failOnce = true;
    chrome.declarativeNetRequest.updateDynamicRules = async (params) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("DNR rejected");
      }
      return origUpdate(params);
    };

    fromOptions(chrome, "useragent", {useragent: "DNR-Fail-UA"});
    await settle();

    if (scenario.expectStored === undefined) {
      assert.equal("useragent" in state.storage, false, scenario.name);
    } else {
      assert.equal(state.storage.useragent, scenario.expectStored, scenario.name);
    }
    assert.equal(context.config.useragent, expectedUA, scenario.name);
    assert.equal(state.rules[0].action.requestHeaders[0].value, expectedUA, scenario.name);
    assert.deepEqual(lastToOptions(state, "useragentInvalid").data, {
      useragent: expectedUA,
      reason: "apply"
    });
  }
});

test("bypassCache false reload, tabs.onUpdated URL icon transitions, removeSite edge cases, and options.load serial consistency", async () => {
  const tabs = [{id: 1, url: "https://naver.com/"}];
  const {chrome, state} = loadBackground({tabs});
  await settle();

  fromOptions(chrome, "bypassCache", {bypassCache: false});
  await settle();
  chrome.action.onClicked.fire(state.tabs[0]);
  await settle();
  assert.deepEqual(state.reloads.pop(), {tabId: 1, bypassCache: false});

  state.tabs[0].url = "https://daum.net/";
  chrome.tabs.onUpdated.fire(1, {url: "https://daum.net/"}, state.tabs[0]);
  await settle();
  assert.equal(state.icons[1], "OFF");

  state.tabs[0].url = "https://naver.com/";
  chrome.tabs.onUpdated.fire(1, {url: "https://naver.com/"}, state.tabs[0]);
  await settle();
  assert.equal(state.icons[1], "ON");

  // removeSite for non-existent site is a no-op
  state.executedScripts.length = 0;
  fromOptions(chrome, "removeSite", {site: "daum.net"});
  await settle();
  assert.deepEqual(state.storage.sites, ["naver.com"]);
  assert.equal(state.rules.length, 3);
  assert.equal(state.scripts.length, 2);
  assert.equal(state.executedScripts.length, 0);

  // removeSite for last remaining site clears all scripts and rules
  fromOptions(chrome, "removeSite", {site: "naver.com"});
  await settle();
  assert.deepEqual(state.storage.sites, []);
  assert.equal(state.rules.length, 0);
  assert.equal(state.scripts.length, 0);
  assert.equal(state.icons[1], "OFF");
  assert.deepEqual(state.executedScripts, [{target: {tabId: 1, allFrames: true}, hasFunc: true}]);

  // options.load serializes behind queued mutations
  state.toOptions.length = 0;
  chrome.action.onClicked.fire(state.tabs[0]);
  fromOptions(chrome, "load");
  await settle();
  assert.deepEqual(
    state.toOptions.map((m) => [m.method, m.method === "sites" ? m.data : null]),
    [["sites", ["naver.com"]], ["settings", null], ["sites", ["naver.com"]]]
  );
});

test("ensureSynced self-heals failed onInstalled, preserves synced Chrome SW restarts, restores wiped scripts, and handles tabs.onReplaced", async (t) => {
  // 1. Failed onInstalled self-heals on next tabs.onActivated
  const healActivated = loadBackground({
    tabs: [{id: 1, url: "https://naver.com/"}],
    storage: {sites: ["naver.com"]}
  });
  const origReg1 = healActivated.chrome.scripting.registerContentScripts;
  let failInstall1 = true;
  healActivated.chrome.scripting.registerContentScripts = async (scripts) => {
    if (failInstall1) {
      failInstall1 = false;
      throw new Error("install failed");
    }
    return origReg1(scripts);
  };
  healActivated.chrome.runtime.onInstalled.fire({reason: "install"});
  await settle();
  assert.equal(healActivated.state.scripts.length, 0);
  assert.equal(healActivated.state.sessionStorage.mobviewSynced, undefined);

  healActivated.chrome.tabs.onActivated.fire({tabId: 1});
  await settle();
  assert.equal(healActivated.state.scripts.length, 2);
  assert.equal(healActivated.state.rules.length, 3);
  assert.equal(healActivated.state.sessionStorage.mobviewSynced, true);
  assert.equal(healActivated.state.icons[1], "ON");

  // 2. Failed onInstalled self-heals on next tabs.onUpdated({status: "loading"})
  const healUpdated = loadBackground({
    tabs: [{id: 1, url: "https://naver.com/"}],
    storage: {sites: ["naver.com"]}
  });
  const origReg2 = healUpdated.chrome.scripting.registerContentScripts;
  let failInstall2 = true;
  healUpdated.chrome.scripting.registerContentScripts = async (scripts) => {
    if (failInstall2) {
      failInstall2 = false;
      throw new Error("install failed");
    }
    return origReg2(scripts);
  };
  healUpdated.chrome.runtime.onInstalled.fire({reason: "install"});
  await settle();
  assert.equal(healUpdated.state.scripts.length, 0);

  healUpdated.chrome.tabs.onUpdated.fire(1, {status: "loading"}, healUpdated.state.tabs[0]);
  await settle();
  assert.equal(healUpdated.state.scripts.length, 2);
  assert.equal(healUpdated.state.rules.length, 3);
  assert.equal(healUpdated.state.sessionStorage.mobviewSynced, true);

  // 3. Chrome reloadBackground preserves synced state without re-registering, and restores wiped scripts
  const {outputDir} = buildChromeTemp(t);
  const initial = loadBackground({
    dir: outputDir,
    tabs: [{id: 1, url: "https://naver.com/"}, {id: 99, url: "https://naver.com/"}],
    storage: {sites: ["naver.com"]}
  });
  initial.chrome.runtime.onInstalled.fire({reason: "install"});
  await settle();
  assert.equal(initial.state.sessionStorage.mobviewSynced, true);
  assert.equal(initial.state.rules.length, 6);

  const warmRestart = reloadBackground(initial.state, {dir: outputDir});
  warmRestart.chrome.tabs.onActivated.fire({tabId: 1});
  await settle();
  assert.deepEqual(warmRestart.state.scriptingCalls, ["get"]);
  assert.equal(warmRestart.context.core.synced, true);
  assert.equal(warmRestart.state.scripts.length, 2);
  assert.equal(warmRestart.state.rules.length, 6);

  const wipedRestart = reloadBackground(warmRestart.state, {dir: outputDir});
  wipedRestart.state.scripts = [];
  fromOptions(wipedRestart.chrome, "load");
  await settle();
  assert.ok(wipedRestart.state.scriptingCalls.includes("register"));
  assert.equal(wipedRestart.state.scripts.length, 2);
  assert.equal(wipedRestart.state.rules.length, 6);

  // 4. tabs.onReplaced updates icon for the replacement tab
  const replacedRestart = reloadBackground(wipedRestart.state, {dir: outputDir});
  replacedRestart.chrome.tabs.onReplaced.fire(99, 1);
  await settle();
  assert.equal(replacedRestart.state.icons[99], "ON");
});

test("checkTopFrame returns enabled state and useragent only for enabled tab URLs", async () => {
  const {chrome, context} = loadBackground({
    storage: {sites: ["naver.com"]}
  });
  await settle();

  const enabled = await chrome.runtime.sendMessage(
    {"path": "content-to-background", "method": "checkTopFrame"},
    undefined,
    undefined,
    {tab: {id: 1, url: "https://m.naver.com/"}}
  );
  assert.deepEqual(enabled, {enabled: true, useragent: context.defaults.useragent});

  for (const sender of [
    {tab: {id: 2, url: "https://daum.net/"}},
    {tab: {id: 3, url: "about:blank"}},
    {}
  ]) {
    const disabled = await chrome.runtime.sendMessage(
      {"path": "content-to-background", "method": "checkTopFrame"},
      undefined,
      undefined,
      sender
    );
    assert.deepEqual(disabled, {enabled: false, useragent: ""});
  }
});

test("parseSiteInput normalizes entered hosts and http(s) URLs while preserving subdomains", () => {
  const {context} = loadBackground();
  const valid = {
    "https://news.naver.com/a?b=1": "news.naver.com",
    "//m.example.com/x": "m.example.com",
    "localhost:3000": "localhost",
    "192.168.0.1:8080/a": "192.168.0.1",
    "[::1]:8080": "[::1]",
    "2001:0DB8::1": "[2001:db8::1]",
    "한글.kr/경로": "xn--bj0bj06e.kr",
    "  WWW.EXAMPLE.COM./path  ": "www.example.com"
  };
  for (const [input, expected] of Object.entries(valid)) {
    assert.equal(context.core.parseSiteInput(input), expected, input);
  }
  const rejected = [
    "",
    "   ",
    "bad host.com",
    "ftp://example.com",
    "about:addons",
    "javascript:alert(1)",
    "chrome://extensions",
    "file:///C:/a.html",
    "alice@example.com",
    "*.example.com",
    "http://*/",
    "12345",
    null
  ];
  for (const input of rejected) {
    assert.equal(context.core.parseSiteInput(input), "", String(input));
  }
});

test("options.addSite validates, deduplicates, subsumes covered sites, syncs matching tabs, and rolls back on failure", async () => {
  const tabs = [
    {id: 1, url: "https://news.naver.com/x"},
    {id: 2, url: "https://www.naver.com/"}
  ];
  const {chrome, state, context} = loadBackground({tabs});
  await settle();

  const sendAddSite = (site) => chrome.runtime.sendMessage({
    path: "options-to-background",
    method: "addSite",
    data: {site}
  });

  const added = await sendAddSite("https://news.naver.com/article");
  await settle();
  assert.deepEqual(added, {ok: true, site: "news.naver.com"});
  assert.deepEqual(state.storage.sites, ["news.naver.com"]);
  assert.deepEqual(state.rules[0].condition.requestDomains, ["news.naver.com"]);
  assert.deepEqual(state.scripts[0].matches, ["*://news.naver.com/*", "*://*.news.naver.com/*"]);
  assert.deepEqual(state.icons, {1: "ON", 2: "OFF"});
  assert.equal(state.tabs[0].sessionStorage.items["mobview-useragent"], context.defaults.useragent);
  assert.equal(state.tabs[1].sessionStorage, undefined);
  assert.deepEqual(state.executedScripts, [
    {target: {tabId: 1, allFrames: true}, hasFunc: true, args: [context.defaults.useragent, ["news.naver.com"]]}
  ]);
  assert.deepEqual(lastToOptions(state, "sites").data, ["news.naver.com"]);
  assert.equal(state.reloads.length, 0);

  const duplicate = await sendAddSite("news.naver.com");
  assert.deepEqual(duplicate, {ok: false, reason: "duplicate", site: "news.naver.com"});
  assert.deepEqual(state.storage.sites, ["news.naver.com"]);

  state.executedScripts.length = 0;
  const parent = await sendAddSite("https://naver.com/");
  await settle();
  assert.deepEqual(parent, {ok: true, site: "naver.com"});
  assert.deepEqual(state.storage.sites, ["naver.com"]);
  assert.deepEqual(state.rules[0].condition.requestDomains, ["naver.com"]);
  assert.deepEqual(state.scripts[0].matches, ["*://naver.com/*", "*://*.naver.com/*"]);
  assert.deepEqual(state.icons, {1: "ON", 2: "ON"});
  assert.equal(state.tabs[0].sessionStorage.items["mobview-useragent"], context.defaults.useragent);
  assert.equal(state.tabs[1].sessionStorage.items["mobview-useragent"], context.defaults.useragent);
  assert.deepEqual(lastToOptions(state, "sites").data, ["naver.com"]);

  const covered = await sendAddSite("blog.naver.com");
  assert.deepEqual(covered, {ok: false, reason: "covered", site: "blog.naver.com", by: "naver.com"});
  assert.deepEqual(state.storage.sites, ["naver.com"]);

  const invalid = await sendAddSite("javascript:alert(1)");
  assert.deepEqual(invalid, {ok: false, reason: "invalid"});
  assert.deepEqual(state.storage.sites, ["naver.com"]);

  // registerContentScripts failure rolls back sites (from empty and pre-existing sites) and returns apply error
  const rollbackEmpty = loadBackground({tabs: [{id: 1, url: "https://naver.com/"}]});
  const origEmptyRegister = rollbackEmpty.chrome.scripting.registerContentScripts;
  let failEmptyOnce = true;
  rollbackEmpty.chrome.scripting.registerContentScripts = async (scripts) => {
    if (failEmptyOnce) {
      failEmptyOnce = false;
      throw new Error("register failed");
    }
    return origEmptyRegister(scripts);
  };
  const emptyFailed = await rollbackEmpty.chrome.runtime.sendMessage({
    path: "options-to-background",
    method: "addSite",
    data: {site: "naver.com"}
  });
  await settle();
  assert.deepEqual(emptyFailed, {ok: false, reason: "apply"});
  assert.deepEqual(rollbackEmpty.state.storage.sites, []);
  assert.equal(rollbackEmpty.state.rules.length, 0);
  assert.equal(rollbackEmpty.state.scripts.length, 0);
  assert.equal(rollbackEmpty.state.icons[1], "OFF");
  assert.equal(rollbackEmpty.state.tabs[0].sessionStorage, undefined);

  const rollbackExisting = loadBackground({
    tabs: [{id: 1, url: "https://naver.com/"}],
    storage: {sites: ["daum.net"]}
  });
  const origExistingRegister = rollbackExisting.chrome.scripting.registerContentScripts;
  let failExistingOnce = true;
  rollbackExisting.chrome.scripting.registerContentScripts = async (scripts) => {
    if (failExistingOnce) {
      failExistingOnce = false;
      throw new Error("register failed");
    }
    return origExistingRegister(scripts);
  };
  const existingFailed = await rollbackExisting.chrome.runtime.sendMessage({
    path: "options-to-background",
    method: "addSite",
    data: {site: "naver.com"}
  });
  await settle();
  assert.deepEqual(existingFailed, {ok: false, reason: "apply"});
  assert.deepEqual(rollbackExisting.state.storage.sites, ["daum.net"]);
  assert.deepEqual(rollbackExisting.state.rules[0].condition.requestDomains, ["daum.net"]);
  assert.deepEqual(rollbackExisting.state.scripts[0].matches, ["*://daum.net/*", "*://*.daum.net/*"]);
  assert.equal(rollbackExisting.state.icons[1], "OFF");
  assert.equal(rollbackExisting.state.tabs[0].sessionStorage, undefined);

  const retried = await rollbackExisting.chrome.runtime.sendMessage({
    path: "options-to-background",
    method: "addSite",
    data: {site: "naver.com"}
  });
  await settle();
  assert.deepEqual(retried, {ok: true, site: "naver.com"});
  assert.deepEqual(rollbackExisting.state.storage.sites, ["daum.net", "naver.com"]);
  assert.equal(rollbackExisting.state.icons[1], "ON");
  assert.equal(rollbackExisting.state.tabs[0].sessionStorage.items["mobview-useragent"], rollbackExisting.context.defaults.useragent);
});
