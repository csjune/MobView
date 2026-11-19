const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const {
  SRC,
  loadBackground,
  runContentScript,
  fakeStorage,
  createWindow,
  createWebIDLNavigator,
  settle
} = require("./harness");
const {buildChrome, chromeDefaults} = require("../scripts/build-chrome");

const CHROME = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPOD = "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";
const IPADOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

function chromeFallbackVersion() {
  const match = /Chrome\/([^\s;)]+)/.exec(chromeDefaults.useragent);
  assert.ok(match, `expected Chrome/<version> in ${chromeDefaults.useragent}`);
  return {full: match[1], major: match[1].split(".")[0]};
}

function captureDescriptors(target, keys) {
  const result = {};
  for (const key of keys) {
    result[key] = Object.getOwnPropertyDescriptor(target, key);
  }
  return result;
}

function assertDescriptorsEqual(target, expected, keys) {
  for (const key of keys) {
    const actual = Object.getOwnPropertyDescriptor(target, key);
    const orig = expected[key];
    if (orig === undefined) {
      assert.equal(actual, undefined, `expected descriptor for ${key} to be absent`);
      continue;
    }
    assert.ok(actual, `expected descriptor for ${key} to exist`);
    assert.deepEqual(actual, orig, `descriptor mismatch for ${key}`);
    if ("get" in orig) assert.equal(actual.get, orig.get, `getter identity mismatch for ${key}`);
    if ("set" in orig) assert.equal(actual.set, orig.set, `setter identity mismatch for ${key}`);
    if ("value" in orig) assert.equal(actual.value, orig.value, `value identity mismatch for ${key}`);
  }
}

function buildChromeTemp(t) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "mobview-chrome-"));
  t.after(() => fs.rmSync(outputDir, {recursive: true, force: true}));
  return buildChrome({outputDir, artifactsDir: null});
}

function desktopNavigator(extra = {}) {
  return Object.create({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
    appVersion: "5.0 (Windows)",
    platform: "Win32",
    vendor: "",
    maxTouchPoints: 0,
    ...extra
  });
}

async function registeredScripts(storage, dir = SRC) {
  const {chrome, state, context} = loadBackground({dir, storage: {sites: ["naver.com"], ...storage}});
  chrome.runtime.onInstalled.fire({reason: "install"});
  await settle();
  return {chrome, state, context, dir, storageScript: state.scripts.find((s) => !s.world), pageScript: state.scripts.find((s) => s.world === "MAIN")};
}

function navigatorValues(navigator) {
  const values = {};
  for (const key of ["userAgent", "appVersion", "platform", "vendor", "maxTouchPoints"]) values[key] = navigator[key];
  return values;
}

test("storage script writes the default user-agent to sessionStorage, purges localStorage, and emits CustomEvent", async () => {
  const {chrome, context, storageScript} = await registeredScripts({});
  const sessionStorage = fakeStorage();
  const localStorage = fakeStorage({"mobview-useragent": "Stale-UA"});
  const window = createWindow();
  const events = [];
  window.addEventListener("mobview-useragent", (event) => events.push(event.detail), true);

  runContentScript(storageScript, {chrome, sessionStorage, localStorage, window});
  await settle();

  assert.equal(sessionStorage.items["mobview-useragent"], context.defaults.useragent);
  assert.equal("mobview-useragent" in localStorage.items, false);
  assert.deepEqual(events, [context.defaults.useragent]);
});

test("storage script writes a custom user-agent to sessionStorage, purges localStorage, and emits CustomEvent", async () => {
  const {chrome, storageScript} = await registeredScripts({useragent: "UA2"});
  const sessionStorage = fakeStorage();
  const localStorage = fakeStorage({"mobview-useragent": "Stale-UA"});
  const window = createWindow();
  const events = [];
  window.addEventListener("mobview-useragent", (event) => events.push(event.detail), true);

  runContentScript(storageScript, {chrome, sessionStorage, localStorage, window});
  await settle();

  assert.equal(sessionStorage.items["mobview-useragent"], "UA2");
  assert.equal("mobview-useragent" in localStorage.items, false);
  assert.deepEqual(events, ["UA2"]);
});

test("storage script sanitizes non-ASCII, control-char, and multiline UA in chrome.storage.local", async () => {
  for (const invalid of ["Mozilla/5.0 한글", "Bad\x00UA"]) {
    const {chrome, context, storageScript} = await registeredScripts({useragent: invalid});
    const sessionStorage = fakeStorage();
    const localStorage = fakeStorage();
    const window = createWindow();
    const events = [];
    window.addEventListener("mobview-useragent", (event) => events.push(event.detail), true);

    runContentScript(storageScript, {chrome, sessionStorage, localStorage, window});
    await settle();

    assert.equal(sessionStorage.items["mobview-useragent"], context.defaults.useragent);
    assert.deepEqual(events, [context.defaults.useragent]);
  }

  const {chrome, storageScript} = await registeredScripts({useragent: "Mozilla/5.0\r\n(Android 15)\tMobile"});
  const sessionStorage = fakeStorage();
  const localStorage = fakeStorage();
  const window = createWindow();
  const events = [];
  window.addEventListener("mobview-useragent", (event) => events.push(event.detail), true);

  runContentScript(storageScript, {chrome, sessionStorage, localStorage, window});
  await settle();

  const stored = sessionStorage.items["mobview-useragent"];
  assert.equal(stored, "Mozilla/5.0 (Android 15) Mobile");
  assert.deepEqual(events, ["Mozilla/5.0 (Android 15) Mobile"]);
});

test("page script hides CustomEvent from bubble listeners and keeps UA in a private closure", async () => {
  const {chrome, storageScript, pageScript} = await registeredScripts({useragent: "Custom-Mobile-UA"});
  const navigator = desktopNavigator();
  const sessionStorage = fakeStorage();
  const localStorage = fakeStorage();
  const window = createWindow();

  runContentScript(pageScript, {navigator, sessionStorage, window});
  const bubbleEvents = [];
  window.addEventListener("mobview-useragent", (event) => bubbleEvents.push(event.detail), false);
  window.addEventListener("mobview-channel", (event) => bubbleEvents.push(event.detail), false);
  runContentScript(storageScript, {chrome, sessionStorage, localStorage, window});
  await settle();

  assert.deepEqual(bubbleEvents, []);
  assert.equal(navigator.userAgent, "Custom-Mobile-UA");

  sessionStorage.clear();
  window.dispatchEvent(new window.CustomEvent("mobview-useragent", {detail: "Spoofed"}));
  window.dispatchEvent(new window.CustomEvent("mobview-channel", {detail: "evil"}));
  window.dispatchEvent(new window.CustomEvent("evil", {detail: "Spoofed"}));
  assert.equal(navigator.userAgent, "Custom-Mobile-UA");
});

test("page script receives UA from storageScript even when sessionStorage is blocked", async () => {
  const {chrome, context, storageScript, pageScript} = await registeredScripts({});
  const navigator = desktopNavigator();
  const sessionStorage = fakeStorage({}, {blocked: true});
  const localStorage = fakeStorage({}, {blocked: true});
  const window = createWindow();

  runContentScript(pageScript, {navigator, sessionStorage, window});
  runContentScript(storageScript, {chrome, sessionStorage, localStorage, window});
  await settle();

  assert.deepEqual(navigatorValues(navigator), {
    userAgent: context.defaults.useragent,
    appVersion: "5.0 (Android 15)",
    platform: "Linux armv8l",
    vendor: "",
    maxTouchPoints: 5
  });
});

test("page script matches navigator values to the default Android Firefox user-agent", async () => {
  const {context, pageScript} = await registeredScripts({});
  const navigator = desktopNavigator();
  runContentScript(pageScript, {
    navigator,
    sessionStorage: fakeStorage({"mobview-useragent": context.defaults.useragent}),
    window: createWindow()
  });
  assert.deepEqual(navigatorValues(navigator), {
    userAgent: context.defaults.useragent,
    appVersion: "5.0 (Android 15)",
    platform: "Linux armv8l",
    vendor: "",
    maxTouchPoints: 5
  });
});

test("page script matches navigator values to an Android Chrome user-agent", async () => {
  const {pageScript} = await registeredScripts({});
  const navigator = desktopNavigator();
  runContentScript(pageScript, {
    navigator,
    sessionStorage: fakeStorage({"mobview-useragent": CHROME}),
    window: createWindow()
  });
  assert.deepEqual(navigatorValues(navigator), {
    userAgent: CHROME,
    appVersion: CHROME.replace(/^Mozilla\//, ""),
    platform: "Linux armv8l",
    vendor: "Google Inc.",
    maxTouchPoints: 5
  });
});

test("page script matches navigator values to an iPhone user-agent", async () => {
  const {pageScript} = await registeredScripts({});
  const navigator = desktopNavigator();
  runContentScript(pageScript, {
    navigator,
    sessionStorage: fakeStorage({"mobview-useragent": IPHONE}),
    window: createWindow()
  });
  const values = navigatorValues(navigator);
  assert.equal(values.platform, "iPhone");
  assert.equal(values.vendor, "Apple Computer, Inc.");
  assert.equal(values.maxTouchPoints, 5);
});

test("firefox page script uses default UA on cold load and when storage is blocked", async () => {
  const {context, pageScript} = await registeredScripts({});
  for (const sessionStorage of [fakeStorage(), fakeStorage({}, {blocked: true})]) {
    const navigator = desktopNavigator({oscpu: "Windows NT 10.0; Win64; x64"});
    runContentScript(pageScript, {navigator, sessionStorage, window: createWindow()});
    assert.deepEqual(navigatorValues(navigator), {
      userAgent: context.defaults.useragent,
      appVersion: "5.0 (Android 15)",
      platform: "Linux armv8l",
      vendor: "",
      maxTouchPoints: 5
    });
    assert.equal(navigator.oscpu, "Linux armv8l");
  }
});

test("page script defines enumerable getters on Navigator prototype with WebIDL brand checks", async () => {
  const {context, pageScript} = await registeredScripts({});
  const navigator = desktopNavigator();
  runContentScript(pageScript, {
    navigator,
    sessionStorage: fakeStorage({"mobview-useragent": context.defaults.useragent}),
    window: createWindow()
  });

  const proto = Object.getPrototypeOf(navigator);
  assert.equal(Object.hasOwn(navigator, "userAgent"), false);
  assert.equal(Object.getOwnPropertyDescriptor(proto, "userAgent").enumerable, true);

  const enumerableKeys = [];
  for (const k in navigator) enumerableKeys.push(k);
  assert.ok(enumerableKeys.includes("userAgent"));

  assert.throws(() => Object.getPrototypeOf(navigator).userAgent, {name: "TypeError"});
  assert.throws(() => Object.getOwnPropertyDescriptor(proto, "userAgent").get.call({}), {name: "TypeError"});
});

test("reading spoofed navigator properties does not clobber RegExp.$1", async () => {
  const {context, pageScript} = await registeredScripts({});
  const navigator = desktopNavigator({oscpu: "Windows NT 10.0; Win64; x64"});
  const vmContext = runContentScript(pageScript, {
    navigator,
    sessionStorage: fakeStorage({"mobview-useragent": context.defaults.useragent}),
    window: createWindow()
  });

  const regExpCapture = vm.runInContext(`
    /keep-(42)/.test("keep-42");
    void [
      navigator.userAgent,
      navigator.appVersion,
      navigator.platform,
      navigator.vendor,
      navigator.maxTouchPoints,
      navigator.oscpu
    ];
    RegExp.$1;
  `, vmContext);
  assert.equal(regExpCapture, "42");
});

test("page script sets oscpu for Firefox Android and deletes it for Chrome and iPhone", async () => {
  const {context, pageScript} = await registeredScripts({});
  const fxNavigator = desktopNavigator({oscpu: "Windows NT 10.0; Win64; x64"});
  runContentScript(pageScript, {
    navigator: fxNavigator,
    sessionStorage: fakeStorage({"mobview-useragent": context.defaults.useragent}),
    window: createWindow()
  });
  assert.equal(fxNavigator.oscpu, "Linux armv8l");

  for (const ua of [CHROME, IPHONE]) {
    const navigator = desktopNavigator({oscpu: "Windows NT 10.0; Win64; x64"});
    runContentScript(pageScript, {
      navigator,
      sessionStorage: fakeStorage({"mobview-useragent": ua}),
      window: createWindow()
    });
    assert.equal("oscpu" in navigator, false);
    assert.equal(navigator.oscpu, undefined);
  }
});

test("page script matches navigator values to an iPod user-agent", async () => {
  const {pageScript} = await registeredScripts({});
  const navigator = desktopNavigator();
  runContentScript(pageScript, {
    navigator,
    sessionStorage: fakeStorage({"mobview-useragent": IPOD}),
    window: createWindow()
  });
  assert.equal(navigator.platform, "iPod");
  assert.equal(navigator.vendor, "Apple Computer, Inc.");
  assert.equal(navigator.maxTouchPoints, 5);
});

test("page script matches navigator values to a desktop-class iPadOS Safari user-agent", async () => {
  const {pageScript} = await registeredScripts({});
  const navigator = desktopNavigator();
  runContentScript(pageScript, {
    navigator,
    sessionStorage: fakeStorage({"mobview-useragent": IPADOS}),
    window: createWindow()
  });
  assert.equal(navigator.platform, "MacIntel");
  assert.equal(navigator.vendor, "Apple Computer, Inc.");
  assert.equal(navigator.maxTouchPoints, 5);
});

test("cross-origin subframe isolation keeps unenabled top desktop and spoofs enabled top (Firefox)", async () => {
  const {chrome, context, storageScript, pageScript} = await registeredScripts({sites: ["naver.com"]});

  const unenabledNav = desktopNavigator();
  const original = navigatorValues(unenabledNav);
  const unenabledSession = fakeStorage();
  const unenabledWin = createWindow({
    isSubframe: true,
    sameOriginTop: false,
    referrer: "https://m.naver.com/",
    hostname: "www.naver.com"
  });
  runContentScript(pageScript, {navigator: unenabledNav, sessionStorage: unenabledSession, window: unenabledWin});
  runContentScript(storageScript, {
    chrome,
    sessionStorage: unenabledSession,
    localStorage: fakeStorage(),
    window: unenabledWin,
    sender: {tab: {id: 1, url: "https://blog.example.com/"}}
  });
  await settle();
  assert.deepEqual(navigatorValues(unenabledNav), original);
  assert.equal("mobview-useragent" in unenabledSession.items, false);

  const enabledNav = desktopNavigator();
  const enabledSession = fakeStorage();
  const enabledWin = createWindow({
    isSubframe: true,
    sameOriginTop: false,
    referrer: "https://blog.example.com/",
    hostname: "www.naver.com"
  });
  runContentScript(pageScript, {navigator: enabledNav, sessionStorage: enabledSession, window: enabledWin});
  runContentScript(storageScript, {
    chrome,
    sessionStorage: enabledSession,
    localStorage: fakeStorage(),
    window: enabledWin,
    sender: {tab: {id: 2, url: "https://m.naver.com/"}}
  });
  await settle();
  assert.equal(enabledNav.userAgent, context.defaults.useragent);
  assert.equal(enabledNav.platform, "Linux armv8l");
});

test("cross-origin subframe isolation keeps unenabled top desktop and spoofs enabled top (Chrome)", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {chrome, storageScript, pageScript, dir} = await registeredScripts({sites: ["naver.com"]}, outputDir);

  const unenabledNav = desktopNavigator({userAgentData: {mobile: false}});
  const original = navigatorValues(unenabledNav);
  const unenabledSession = fakeStorage();
  const unenabledWin = createWindow({
    isSubframe: true,
    sameOriginTop: false,
    ancestorOrigins: ["https://blog.example.com"],
    hostname: "www.naver.com"
  });
  runContentScript(pageScript, {navigator: unenabledNav, sessionStorage: unenabledSession, window: unenabledWin, dir});
  runContentScript(storageScript, {chrome, sessionStorage: unenabledSession, localStorage: fakeStorage(), window: unenabledWin, dir});
  await settle();
  assert.deepEqual(navigatorValues(unenabledNav), original);
  assert.deepEqual(unenabledNav.userAgentData, {mobile: false});
  assert.equal("mobview-useragent" in unenabledSession.items, false);

  const enabledNav = desktopNavigator({userAgentData: {mobile: false}});
  const enabledSession = fakeStorage();
  const enabledWin = createWindow({
    isSubframe: true,
    sameOriginTop: false,
    ancestorOrigins: ["https://m.naver.com"],
    hostname: "www.naver.com"
  });
  runContentScript(pageScript, {navigator: enabledNav, sessionStorage: enabledSession, window: enabledWin, dir});
  runContentScript(storageScript, {chrome, sessionStorage: enabledSession, localStorage: fakeStorage(), window: enabledWin, dir});
  await settle();
  assert.equal(enabledNav.userAgent, chromeDefaults.useragent);
  assert.equal(enabledNav.platform, "Linux armv8l");
});

test("chrome page script uses mobviewDefaultUserAgent on cold load and when storage is blocked", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {pageScript, dir} = await registeredScripts({}, outputDir);
  for (const sessionStorage of [fakeStorage(), fakeStorage({}, {blocked: true})]) {
    const navigator = desktopNavigator();
    runContentScript(pageScript, {navigator, sessionStorage, window: createWindow(), dir});
    assert.deepEqual(navigatorValues(navigator), {
      userAgent: chromeDefaults.useragent,
      appVersion: chromeDefaults.useragent.replace(/^Mozilla\//, ""),
      platform: "Linux armv8l",
      vendor: "Google Inc.",
      maxTouchPoints: 5
    });
  }
});

test("chrome page script overrides mobviewDefaultUserAgent with custom mobview-useragent in sessionStorage", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {pageScript, dir} = await registeredScripts({}, outputDir);
  const navigator = desktopNavigator();
  runContentScript(pageScript, {
    navigator,
    sessionStorage: fakeStorage({"mobview-useragent": IPHONE}),
    window: createWindow(),
    dir
  });
  assert.deepEqual(navigatorValues(navigator), {
    userAgent: IPHONE,
    appVersion: IPHONE.replace(/^Mozilla\//, ""),
    platform: "iPhone",
    vendor: "Apple Computer, Inc.",
    maxTouchPoints: 5
  });
});

test("chrome page script spoofs navigator.userAgentData for default Chrome Android UA without clobbering RegExp.$1", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {pageScript, dir} = await registeredScripts({}, outputDir);
  const {major: expectedMajor, full: expectedFull} = chromeFallbackVersion();
  const navigator = desktopNavigator({userAgentData: {mobile: false, platform: "Windows"}});
  runContentScript(pageScript, {navigator, sessionStorage: fakeStorage(), window: createWindow(), dir});

  assert.equal("userAgentData" in navigator, true);
  assert.equal(Object.hasOwn(navigator, "userAgentData"), false);
  assert.equal(navigator.userAgentData.mobile, true);
  assert.equal(navigator.userAgentData.platform, "Android");

  const brands = structuredClone(navigator.userAgentData.brands);
  assert.ok(Array.isArray(brands));
  assert.ok(brands.some((entry) => entry.brand === "Chromium" && entry.version === expectedMajor));
  assert.ok(brands.some((entry) => entry.brand === "Google Chrome" && entry.version === expectedMajor));
  assert.deepEqual(structuredClone(navigator.userAgentData.toJSON()), {
    brands,
    mobile: true,
    platform: "Android"
  });

  const high = structuredClone(await navigator.userAgentData.getHighEntropyValues([
    "architecture", "bitness", "formFactors", "fullVersionList",
    "model", "platformVersion", "uaFullVersion", "wow64"
  ]));
  assert.deepEqual(Object.keys(high).sort(), [
    "architecture", "bitness", "brands", "formFactors", "fullVersionList",
    "mobile", "model", "platform", "platformVersion", "uaFullVersion", "wow64"
  ]);
  assert.equal(high.architecture, "");
  assert.equal(high.bitness, "");
  assert.deepEqual(high.formFactors, ["Mobile"]);
  assert.equal(high.model, "K");
  assert.equal(high.platformVersion, "10.0.0");
  assert.equal(high.uaFullVersion, expectedFull);
  assert.equal(high.wow64, false);
  assert.deepEqual(high.brands, brands);
  assert.equal(high.mobile, true);
  assert.equal(high.platform, "Android");
  assert.ok(Array.isArray(high.fullVersionList));
  assert.equal(high.fullVersionList.length, brands.length);
  assert.ok(high.fullVersionList.some((entry) => entry.brand === "Chromium" && entry.version === expectedFull));
  assert.ok(high.fullVersionList.some((entry) => entry.brand === "Google Chrome" && entry.version === expectedFull));

  await assert.rejects(() => navigator.userAgentData.getHighEntropyValues("not-array"), {name: "TypeError"});
  assert.throws(() => Object.getPrototypeOf(navigator).userAgentData, {name: "TypeError"});

  const regExpNav = desktopNavigator({userAgentData: {mobile: false, platform: "Windows"}});
  const vmContext = runContentScript(pageScript, {
    navigator: regExpNav,
    sessionStorage: fakeStorage(),
    window: createWindow(),
    dir
  });
  const regExpCapture = await vm.runInContext(`
    (async () => {
      /keep-(42)/.test("keep-42");
      const uad = navigator.userAgentData;
      void [uad.brands, uad.mobile, uad.platform, uad.toJSON()];
      await uad.getHighEntropyValues([
        "architecture", "bitness", "formFactors", "fullVersionList",
        "model", "platformVersion", "uaFullVersion", "wow64"
      ]);
      return RegExp.$1;
    })();
  `, vmContext);
  assert.equal(regExpCapture, "42");
});

test("chrome page script hides navigator.userAgentData for non-Chromium UAs", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {pageScript, dir} = await registeredScripts({}, outputDir);
  const {context: fxContext} = loadBackground();
  const nonChromiumUAs = [IPHONE, IPADOS, fxContext.defaults.useragent];

  for (const ua of nonChromiumUAs) {
    const protoNav = desktopNavigator({userAgentData: {mobile: false}});
    runContentScript(pageScript, {
      navigator: protoNav,
      sessionStorage: fakeStorage({"mobview-useragent": ua}),
      window: createWindow(),
      dir
    });
    assert.equal("userAgentData" in protoNav, false, ua);
    assert.equal(protoNav.userAgentData, undefined, ua);
    assert.equal("userAgentData" in protoNav && protoNav.userAgentData.mobile, false, ua);

    const ownNav = desktopNavigator();
    ownNav.userAgentData = {mobile: false};
    runContentScript(pageScript, {
      navigator: ownNav,
      sessionStorage: fakeStorage({"mobview-useragent": ua}),
      window: createWindow(),
      dir
    });
    assert.equal("userAgentData" in ownNav, false, ua);
    assert.equal(ownNav.userAgentData, undefined, ua);
    assert.equal("userAgentData" in ownNav && ownNav.userAgentData.mobile, false, ua);
  }
});


test("Firefox cross-origin subframe fails closed across nested, no-referrer, sandboxed, corrupt-sites, and runtime.lastError cases", async () => {
  const base = await registeredScripts({sites: ["naver.com"]});

  async function expectFailClosed({window, chrome = base.chrome, sender}) {
    const navigator = desktopNavigator({oscpu: "Windows NT 10.0; Win64; x64"});
    const original = navigatorValues(navigator);
    const sessionStorage = fakeStorage({"mobview-useragent": "Stale-Mobile-UA"});
    runContentScript(base.pageScript, {navigator, sessionStorage, window});
    runContentScript(base.storageScript, {
      chrome,
      sessionStorage,
      localStorage: fakeStorage(),
      window,
      sender
    });
    await settle();
    assert.deepEqual(navigatorValues(navigator), original);
    assert.equal(navigator.oscpu, "Windows NT 10.0; Win64; x64");
    assert.equal("mobview-useragent" in sessionStorage.items, false);
  }

  /* 1. Nested frame (window.parent !== window.top) with same-origin parent and unenabled cross-origin top */
  const nestedWin = createWindow({
    isSubframe: true,
    sameOriginTop: false,
    referrer: "https://m.naver.com/",
    hostname: "www.naver.com"
  });
  nestedWin.parent = {location: {hostname: "www.naver.com", href: "https://www.naver.com/"}};
  assert.notEqual(nestedWin.parent, nestedWin.top);
  await expectFailClosed({
    window: nestedWin,
    sender: {tab: {id: 1, url: "https://blog.example.com/"}}
  });

  /* 2. No-referrer cross-origin subframe (unenabled tab or missing sender.tab) */
  await expectFailClosed({
    window: createWindow({isSubframe: true, sameOriginTop: false, referrer: "", hostname: "www.naver.com"}),
    sender: {tab: {id: 1, url: "https://blog.example.com/"}}
  });
  await expectFailClosed({
    window: createWindow({isSubframe: true, sameOriginTop: false, referrer: "", hostname: "www.naver.com"}),
    sender: {}
  });

  /* 3. Enabled referrer spoofing attempt on unenabled top tab */
  await expectFailClosed({
    window: createWindow({isSubframe: true, sameOriginTop: false, referrer: "https://m.naver.com/", hostname: "www.naver.com"}),
    sender: {tab: {id: 1, url: "https://blog.example.com/"}}
  });

  /* 4. Sandboxed iframe with opaque "null" ancestor origin even when sender.tab is enabled */
  await expectFailClosed({
    window: createWindow({
      isSubframe: true,
      sameOriginTop: false,
      ancestorOrigins: ["null"],
      hostname: "www.naver.com"
    }),
    sender: {tab: {id: 2, url: "https://m.naver.com/"}}
  });

  /* 5. Missing/corrupt sites (null or []) in chrome.storage.local and background */
  for (const corruptSites of [null, []]) {
    const hostBg = loadBackground({storage: {sites: corruptSites}});
    await expectFailClosed({
      window: createWindow({
        isSubframe: true,
        sameOriginTop: false,
        ancestorOrigins: ["https://m.naver.com"],
        hostname: "www.naver.com"
      }),
      chrome: hostBg.chrome
    });

    const askBg = loadBackground({storage: {sites: corruptSites}});
    await expectFailClosed({
      window: createWindow({isSubframe: true, sameOriginTop: false, referrer: "", hostname: "www.naver.com"}),
      chrome: askBg.chrome,
      sender: {tab: {id: 2, url: "https://m.naver.com/"}}
    });
  }

  /* 6. chrome.runtime.lastError during checkTopFrame */
  const lastErrorChrome = {
    storage: base.chrome.storage,
    runtime: {
      lastError: null,
      sendMessage(_msg, cb) {
        setTimeout(() => {
          lastErrorChrome.runtime.lastError = {message: "Could not establish connection."};
          cb(undefined);
          lastErrorChrome.runtime.lastError = null;
        });
      }
    }
  };
  await expectFailClosed({
    window: createWindow({isSubframe: true, sameOriginTop: false, referrer: "", hostname: "www.naver.com"}),
    chrome: lastErrorChrome
  });
});

test("WebIDL Navigator.prototype and native NavigatorUAData preserve brand checks, descriptors, and toStringTag", async (t) => {
  /* Case A: Chromium native NavigatorUAData */
  const {outputDir} = buildChromeTemp(t);
  const {pageScript: chromePageScript, dir} = await registeredScripts({}, outputDir);
  const nativeEnv = createWebIDLNavigator({
    userAgentData: {
      brands: [{brand: "Chromium", version: "120"}],
      mobile: false,
      platform: "Windows"
    }
  });
  runContentScript(chromePageScript, {
    navigator: nativeEnv.navigator,
    Navigator: nativeEnv.Navigator,
    NavigatorUAData: nativeEnv.NavigatorUAData,
    sessionStorage: fakeStorage(),
    window: createWindow(),
    dir
  });

  const navA = nativeEnv.navigator;
  const NavProtoA = nativeEnv.Navigator.prototype;
  const UADataCtor = nativeEnv.NavigatorUAData;
  const UADataProto = UADataCtor.prototype;

  assert.equal(navA.userAgentData instanceof UADataCtor, true);
  assert.equal(Object.prototype.toString.call(navA.userAgentData), "[object NavigatorUAData]");
  assert.deepEqual(Object.getOwnPropertyNames(navA.userAgentData), []);
  assert.equal(Object.getOwnPropertyDescriptor(UADataProto, "mobile").get.call(navA.userAgentData), true);

  for (const key of ["userAgent", "appVersion", "platform", "vendor", "maxTouchPoints"]) {
    const desc = Object.getOwnPropertyDescriptor(NavProtoA, key);
    assert.equal(typeof desc.get, "function");
    assert.equal(desc.get.name, `get ${key}`);
  }
  for (const key of ["brands", "mobile", "platform"]) {
    const desc = Object.getOwnPropertyDescriptor(UADataProto, key);
    assert.equal(desc.get.name, `get ${key}`);
  }
  assert.equal(UADataProto.toJSON.name, "toJSON");
  assert.equal(UADataProto.getHighEntropyValues.name, "getHighEntropyValues");
  assert.throws(() => Object.create(navA).userAgent, {name: "TypeError"});
  assert.throws(() => Object.create(navA).userAgentData, {name: "TypeError"});
  assert.throws(() => UADataProto.toJSON.call({}), {name: "TypeError"});
  await assert.rejects(() => UADataProto.getHighEntropyValues.call({}, []), {name: "TypeError"});

  /* Check oscpu getter name and WebIDL brand check when spoofing Firefox UA on WebIDL navigator */
  const {context: fxContext, pageScript: fxPageScript} = await registeredScripts({});
  const fxBrandEnv = createWebIDLNavigator({
    userAgentData: {brands: [{brand: "Chromium", version: "120"}], mobile: false, platform: "Windows"}
  });
  runContentScript(fxPageScript, {
    navigator: fxBrandEnv.navigator,
    Navigator: fxBrandEnv.Navigator,
    NavigatorUAData: fxBrandEnv.NavigatorUAData,
    sessionStorage: fakeStorage({"mobview-useragent": fxContext.defaults.useragent}),
    window: createWindow()
  });
  assert.equal(Object.getOwnPropertyDescriptor(fxBrandEnv.Navigator.prototype, "oscpu").get.name, "get oscpu");
  assert.throws(() => Object.create(fxBrandEnv.navigator).oscpu, {name: "TypeError"});

  /* Case B: Firefox mock without native NavigatorUAData */
  const fxEnv = createWebIDLNavigator({oscpu: "Windows NT 10.0; Win64; x64"});
  runContentScript(fxPageScript, {
    navigator: fxEnv.navigator,
    Navigator: fxEnv.Navigator,
    sessionStorage: fakeStorage({"mobview-useragent": CHROME}),
    window: createWindow()
  });
  const navB = fxEnv.navigator;
  assert.equal(Object.getOwnPropertyDescriptor(fxEnv.Navigator.prototype, "userAgentData").get.name, "get userAgentData");
  assert.equal(Object.prototype.toString.call(navB.userAgentData), "[object NavigatorUAData]");
  assert.equal(navB.userAgentData[Symbol.toStringTag], "NavigatorUAData");
  assert.deepEqual(Object.getOwnPropertyNames(navB.userAgentData), []);
  assert.throws(() => Object.create(navB.userAgentData).mobile, {name: "TypeError"});
  assert.throws(() => Object.create(navB).userAgent, {name: "TypeError"});
  assert.throws(() => Object.create(navB).userAgentData, {name: "TypeError"});
});

test("page script installs lazily in unenabled cross-origin iframe and restores all descriptors on applyUA('')", async (t) => {
  const navKeys = ["userAgent", "appVersion", "platform", "vendor", "maxTouchPoints", "oscpu", "userAgentData"];
  const uaDataKeys = ["brands", "mobile", "platform", "toJSON", "getHighEntropyValues"];

  /* 1. Lazy install & ignored stale sessionStorage in cross-origin iframe */
  const {chrome: fxChrome, context: fxContext, storageScript: fxStorage, pageScript: fxPage} = await registeredScripts({sites: ["naver.com"]});
  const lazyEnv = createWebIDLNavigator({
    oscpu: "Windows NT 10.0; Win64; x64",
    userAgentData: {brands: [], mobile: false, platform: "Windows"}
  });
  const origNavGet = Object.getOwnPropertyDescriptor(lazyEnv.Navigator.prototype, "userAgent").get;
  const origNavValues = navigatorValues(lazyEnv.navigator);

  const staleSession = fakeStorage({"mobview-useragent": "Stale-Mobile-UA"});
  const unenabledWin = createWindow({isSubframe: true, sameOriginTop: false, hostname: "www.naver.com"});
  runContentScript(fxPage, {
    navigator: lazyEnv.navigator,
    Navigator: lazyEnv.Navigator,
    NavigatorUAData: lazyEnv.NavigatorUAData,
    sessionStorage: staleSession,
    window: unenabledWin
  });
  assert.equal(Object.getOwnPropertyDescriptor(lazyEnv.Navigator.prototype, "userAgent").get, origNavGet);
  assert.deepEqual(navigatorValues(lazyEnv.navigator), origNavValues);

  runContentScript(fxStorage, {
    chrome: fxChrome,
    sessionStorage: staleSession,
    localStorage: fakeStorage(),
    window: unenabledWin,
    sender: {tab: {id: 1, url: "https://blog.example.com/"}}
  });
  await settle();
  assert.equal(Object.getOwnPropertyDescriptor(lazyEnv.Navigator.prototype, "userAgent").get, origNavGet);
  assert.deepEqual(navigatorValues(lazyEnv.navigator), origNavValues);
  assert.equal("mobview-useragent" in staleSession.items, false);

  /* When enabled via storageScript, lazy install activates */
  const lazyEnabledEnv = createWebIDLNavigator({oscpu: "Windows NT 10.0; Win64; x64"});
  const lazyEnabledOrigGet = Object.getOwnPropertyDescriptor(lazyEnabledEnv.Navigator.prototype, "userAgent").get;
  const enabledWin = createWindow({isSubframe: true, sameOriginTop: false, hostname: "www.naver.com"});
  runContentScript(fxPage, {
    navigator: lazyEnabledEnv.navigator,
    Navigator: lazyEnabledEnv.Navigator,
    sessionStorage: fakeStorage(),
    window: enabledWin
  });
  assert.equal(Object.getOwnPropertyDescriptor(lazyEnabledEnv.Navigator.prototype, "userAgent").get, lazyEnabledOrigGet);
  runContentScript(fxStorage, {
    chrome: fxChrome,
    sessionStorage: fakeStorage(),
    localStorage: fakeStorage(),
    window: enabledWin,
    sender: {tab: {id: 2, url: "https://m.naver.com/"}}
  });
  await settle();
  assert.notEqual(Object.getOwnPropertyDescriptor(lazyEnabledEnv.Navigator.prototype, "userAgent").get, lazyEnabledOrigGet);
  assert.equal(lazyEnabledEnv.navigator.userAgent, fxContext.defaults.useragent);

  /* 2a. Full applyUA("") restoration on Chrome native NavigatorUAData */
  const {outputDir} = buildChromeTemp(t);
  const {chrome: chChrome, storageScript: chStorage, pageScript: chPage, dir} = await registeredScripts({sites: ["naver.com"]}, outputDir);
  const restoreChromeEnv = createWebIDLNavigator({
    userAgentData: {brands: [{brand: "Chromium", version: "120"}], mobile: false, platform: "Windows"}
  });
  const origChromeNavDescs = captureDescriptors(restoreChromeEnv.Navigator.prototype, navKeys);
  const origChromeUADataDescs = captureDescriptors(restoreChromeEnv.NavigatorUAData.prototype, uaDataKeys);
  const origChromeValues = navigatorValues(restoreChromeEnv.navigator);

  const sameOriginUnenabledWin = createWindow({
    isSubframe: true,
    sameOriginTop: true,
    topHostname: "blog.example.com",
    hostname: "www.naver.com"
  });
  const restoreSessionA = fakeStorage();
  runContentScript(chPage, {
    navigator: restoreChromeEnv.navigator,
    Navigator: restoreChromeEnv.Navigator,
    NavigatorUAData: restoreChromeEnv.NavigatorUAData,
    sessionStorage: restoreSessionA,
    window: sameOriginUnenabledWin,
    dir
  });
  /* Cold load initially spoofed because sameOriginTop was accessible */
  assert.equal(restoreChromeEnv.navigator.userAgent, chromeDefaults.useragent);
  assert.equal(restoreChromeEnv.navigator.userAgentData.mobile, true);
  assert.notEqual(
    Object.getOwnPropertyDescriptor(restoreChromeEnv.NavigatorUAData.prototype, "mobile").get,
    origChromeUADataDescs.mobile.get
  );

  runContentScript(chStorage, {
    chrome: chChrome,
    sessionStorage: restoreSessionA,
    localStorage: fakeStorage(),
    window: sameOriginUnenabledWin,
    dir
  });
  await settle();

  assertDescriptorsEqual(restoreChromeEnv.Navigator.prototype, origChromeNavDescs, navKeys);
  assertDescriptorsEqual(restoreChromeEnv.NavigatorUAData.prototype, origChromeUADataDescs, uaDataKeys);
  assert.deepEqual(navigatorValues(restoreChromeEnv.navigator), origChromeValues);
  assert.equal(restoreChromeEnv.navigator.userAgentData.mobile, false);
  assert.equal(restoreChromeEnv.navigator.userAgentData.platform, "Windows");
  assert.equal("mobview-useragent" in restoreSessionA.items, false);

  /* 2b. Full applyUA("") restoration on Firefox WebIDL with oscpu after cold-loading CHROME */
  const restoreFxEnv = createWebIDLNavigator({oscpu: "Windows NT 10.0; Win64; x64"});
  const origFxNavDescs = captureDescriptors(restoreFxEnv.Navigator.prototype, navKeys);
  const origFxValues = navigatorValues(restoreFxEnv.navigator);
  const fxSubframeWin = createWindow({
    isSubframe: true,
    sameOriginTop: true,
    topHostname: "blog.example.com",
    hostname: "www.naver.com"
  });
  const restoreSessionB = fakeStorage({"mobview-useragent": CHROME});
  runContentScript(fxPage, {
    navigator: restoreFxEnv.navigator,
    Navigator: restoreFxEnv.Navigator,
    sessionStorage: restoreSessionB,
    window: fxSubframeWin
  });
  assert.equal("userAgentData" in restoreFxEnv.navigator, true);
  assert.equal("oscpu" in restoreFxEnv.navigator, false);

  runContentScript(fxStorage, {
    chrome: fxChrome,
    sessionStorage: restoreSessionB,
    localStorage: fakeStorage(),
    window: fxSubframeWin
  });
  await settle();

  assertDescriptorsEqual(restoreFxEnv.Navigator.prototype, origFxNavDescs, navKeys);
  assert.deepEqual(navigatorValues(restoreFxEnv.navigator), origFxValues);
  assert.equal(restoreFxEnv.navigator.oscpu, "Windows NT 10.0; Win64; x64");
  assert.equal("userAgentData" in restoreFxEnv.navigator, false);
});

test("switching between Chrome and Firefox/iPhone via storageScript updates userAgentData and oscpu cleanly", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {context: fxContext} = loadBackground();
  const uaDataKeys = ["brands", "mobile", "platform", "toJSON", "getHighEntropyValues"];

  /* Chrome default page -> Firefox UA */
  {
    const {chrome, storageScript, pageScript, dir} = await registeredScripts({useragent: fxContext.defaults.useragent}, outputDir);
    const env = createWebIDLNavigator({
      oscpu: "Windows NT 10.0; Win64; x64",
      userAgentData: {brands: [{brand: "Chromium", version: "120"}], mobile: false, platform: "Windows"}
    });
    const origUADataDescs = captureDescriptors(env.NavigatorUAData.prototype, uaDataKeys);
    const sessionStorage = fakeStorage();
    const win = createWindow();

    runContentScript(pageScript, {
      navigator: env.navigator,
      Navigator: env.Navigator,
      NavigatorUAData: env.NavigatorUAData,
      sessionStorage,
      window: win,
      dir
    });
    assert.equal(env.navigator.userAgent, chromeDefaults.useragent);
    assert.equal("userAgentData" in env.navigator, true);
    assert.equal("oscpu" in env.navigator, false);

    runContentScript(storageScript, {chrome, sessionStorage, localStorage: fakeStorage(), window: win, dir});
    await settle();

    assert.equal(env.navigator.userAgent, fxContext.defaults.useragent);
    assert.equal("userAgentData" in env.navigator, false);
    assert.equal(env.navigator.userAgentData, undefined);
    assertDescriptorsEqual(env.NavigatorUAData.prototype, origUADataDescs, uaDataKeys);
    assert.equal(env.navigator.oscpu, "Linux armv8l");
  }

  /* Chrome default page -> iPhone UA */
  {
    const {chrome, storageScript, pageScript, dir} = await registeredScripts({useragent: IPHONE}, outputDir);
    const env = createWebIDLNavigator({
      oscpu: "Windows NT 10.0; Win64; x64",
      userAgentData: {brands: [{brand: "Chromium", version: "120"}], mobile: false, platform: "Windows"}
    });
    const origUADataDescs = captureDescriptors(env.NavigatorUAData.prototype, uaDataKeys);
    const sessionStorage = fakeStorage();
    const win = createWindow();

    runContentScript(pageScript, {
      navigator: env.navigator,
      Navigator: env.Navigator,
      NavigatorUAData: env.NavigatorUAData,
      sessionStorage,
      window: win,
      dir
    });
    runContentScript(storageScript, {chrome, sessionStorage, localStorage: fakeStorage(), window: win, dir});
    await settle();

    assert.equal(env.navigator.userAgent, IPHONE);
    assert.equal("userAgentData" in env.navigator, false);
    assertDescriptorsEqual(env.NavigatorUAData.prototype, origUADataDescs, uaDataKeys);
    assert.equal("oscpu" in env.navigator, false);
    assert.equal(env.navigator.oscpu, undefined);
  }

  /* Reverse: Firefox default page -> Chrome UA via handshake (with and without native NavigatorUAData) */
  for (const withNativeUAData of [true, false]) {
    const {chrome, storageScript, pageScript} = await registeredScripts({useragent: CHROME});
    const env = createWebIDLNavigator({
      oscpu: "Windows NT 10.0; Win64; x64",
      ...(withNativeUAData ? {userAgentData: {brands: [], mobile: false, platform: "Windows"}} : {})
    });
    const sessionStorage = fakeStorage();
    const win = createWindow();

    runContentScript(pageScript, {
      navigator: env.navigator,
      Navigator: env.Navigator,
      NavigatorUAData: env.NavigatorUAData,
      sessionStorage,
      window: win
    });
    assert.equal(env.navigator.oscpu, "Linux armv8l");
    assert.equal("userAgentData" in env.navigator, false);

    runContentScript(storageScript, {chrome, sessionStorage, localStorage: fakeStorage(), window: win});
    await settle();

    assert.equal(env.navigator.userAgent, CHROME);
    assert.equal("oscpu" in env.navigator, false);
    assert.equal("userAgentData" in env.navigator, true);
    assert.equal(env.navigator.userAgentData.mobile, true);
    assert.equal(env.navigator.userAgentData.platform, "Android");
    assert.ok(env.navigator.userAgentData.brands.some((b) => b.brand === "Google Chrome" && b.version === "155"));
    if (withNativeUAData) {
      assert.equal(env.navigator.userAgentData instanceof env.NavigatorUAData, true);
    }
  }
});

test("bidirectional handshake delivers UA when storageScript resolves before pageScript and rejects corrupt sessionStorage", async (t) => {
  /* 1. storageScript resolves BEFORE pageScript runs, even with blocked sessionStorage */
  {
    const {chrome, storageScript, pageScript} = await registeredScripts({useragent: "Custom-Reverse-UA"});
    const navigator = desktopNavigator();
    const sessionStorage = fakeStorage({}, {blocked: true});
    const localStorage = fakeStorage({}, {blocked: true});
    const window = createWindow();

    runContentScript(storageScript, {chrome, sessionStorage, localStorage, window});
    await settle();

    const bubbleEvents = [];
    window.addEventListener("mobview-ready", (event) => bubbleEvents.push(event.type), false);
    window.addEventListener("mobview-useragent", (event) => bubbleEvents.push(event.detail), false);

    runContentScript(pageScript, {navigator, sessionStorage, window});

    assert.equal(navigator.userAgent, "Custom-Reverse-UA");
    assert.deepEqual(bubbleEvents, []);
  }

  /* 2. Reverse order on unenabled cross-origin subframe stays desktop */
  {
    const {chrome, storageScript, pageScript} = await registeredScripts({sites: ["naver.com"]});
    const navigator = desktopNavigator();
    const original = navigatorValues(navigator);
    const sessionStorage = fakeStorage();
    const window = createWindow({isSubframe: true, sameOriginTop: false, hostname: "www.naver.com"});

    runContentScript(storageScript, {
      chrome,
      sessionStorage,
      localStorage: fakeStorage(),
      window,
      sender: {tab: {id: 1, url: "https://blog.example.com/"}}
    });
    await settle();

    runContentScript(pageScript, {navigator, sessionStorage, window});
    assert.deepEqual(navigatorValues(navigator), original);
    assert.equal("mobview-useragent" in sessionStorage.items, false);
  }

  /* 3. Corrupt sessionStorage ("Bad\n\u0000한글") is rejected by readSession() */
  {
    const {context, pageScript} = await registeredScripts({});
    const topNav = desktopNavigator();
    runContentScript(pageScript, {
      navigator: topNav,
      sessionStorage: fakeStorage({"mobview-useragent": "Bad\n\u0000한글"}),
      window: createWindow()
    });
    assert.equal(topNav.userAgent, context.defaults.useragent);

    const subNav = desktopNavigator();
    const orig = navigatorValues(subNav);
    runContentScript(pageScript, {
      navigator: subNav,
      sessionStorage: fakeStorage({"mobview-useragent": "Bad\n\u0000한글"}),
      window: createWindow({isSubframe: true, sameOriginTop: false, hostname: "www.naver.com"})
    });
    assert.deepEqual(navigatorValues(subNav), orig);
  }

  /* Chrome build corrupt sessionStorage fallback */
  {
    const {outputDir} = buildChromeTemp(t);
    const {pageScript, dir} = await registeredScripts({}, outputDir);
    const topNav = desktopNavigator();
    runContentScript(pageScript, {
      navigator: topNav,
      sessionStorage: fakeStorage({"mobview-useragent": "Bad\n\u0000한글"}),
      window: createWindow(),
      dir
    });
    assert.equal(topNav.userAgent, chromeDefaults.useragent);
  }
});

test("getHighEntropyValues handles WebIDL sequence<DOMString>, rejects async on bad iterables, and avoids mutating cached arrays", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {pageScript: chromePageScript, dir} = await registeredScripts({}, outputDir);
  const {pageScript: fxPageScript} = await registeredScripts({});

  const nativeEnv = createWebIDLNavigator({
    userAgentData: {brands: [], mobile: false, platform: "Windows"}
  });
  runContentScript(chromePageScript, {
    navigator: nativeEnv.navigator,
    Navigator: nativeEnv.Navigator,
    NavigatorUAData: nativeEnv.NavigatorUAData,
    sessionStorage: fakeStorage(),
    window: createWindow(),
    dir
  });

  const fxEnv = createWebIDLNavigator({oscpu: "Windows NT 10.0; Win64; x64"});
  runContentScript(fxPageScript, {
    navigator: fxEnv.navigator,
    Navigator: fxEnv.Navigator,
    sessionStorage: fakeStorage({"mobview-useragent": chromeDefaults.useragent}),
    window: createWindow()
  });

  for (const uad of [nativeEnv.navigator.userAgentData, fxEnv.navigator.userAgentData]) {
    const fromSet = structuredClone(await uad.getHighEntropyValues(new Set(["model", "platformVersion"])));
    assert.equal(fromSet.model, "K");
    assert.equal(fromSet.platformVersion, "10.0.0");

    const fromStringifiable = structuredClone(await uad.getHighEntropyValues([{toString() {return "model";}}]));
    assert.equal(fromStringifiable.model, "K");

    /* Bad iterables / throwing toString must return rejected Promise, NOT throw synchronously */
    const throwingIter = {[Symbol.iterator]() {throw new RangeError("bad iterator");}};
    const p1 = uad.getHighEntropyValues(throwingIter);
    assert.equal(typeof p1?.then, "function");
    await assert.rejects(() => p1, {name: "RangeError", message: "bad iterator"});

    const throwingNext = {[Symbol.iterator]: () => ({next() {throw new TypeError("bad next");}})};
    const p2 = uad.getHighEntropyValues(throwingNext);
    assert.equal(typeof p2?.then, "function");
    await assert.rejects(() => p2, {name: "TypeError", message: "bad next"});

    const throwingToString = [{toString() {throw new Error("bad toString");}}];
    const p3 = uad.getHighEntropyValues(throwingToString);
    assert.equal(typeof p3?.then, "function");
    await assert.rejects(() => p3, {message: "bad toString"});

    const p4 = uad.getHighEntropyValues(null);
    assert.equal(typeof p4?.then, "function");
    await assert.rejects(() => p4, {name: "TypeError"});

    /* Array mutation does not corrupt internal cached state */
    const brandsBefore = structuredClone(uad.brands);
    const brandsCopy = uad.brands;
    brandsCopy.push({brand: "Evil", version: "99"});
    brandsCopy[0].brand = "Mutated";
    assert.deepEqual(structuredClone(uad.brands), brandsBefore);

    const high1 = await uad.getHighEntropyValues(["fullVersionList", "formFactors"]);
    const expectedFull = structuredClone(high1.fullVersionList);
    const expectedFF = structuredClone(high1.formFactors);
    high1.fullVersionList.pop();
    high1.fullVersionList[0].version = "0.0.0.0";
    high1.formFactors.push("Evil");

    const high2 = await uad.getHighEntropyValues(["fullVersionList", "formFactors"]);
    assert.deepEqual(structuredClone(high2.fullVersionList), expectedFull);
    assert.deepEqual(structuredClone(high2.formFactors), expectedFF);
  }
});

test("page script parses Edge, Opera, Samsung, WebView, Chromium-only, desktop, tablet, iPad, and bracketless Firefox UAs", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {pageScript: chromePageScript, dir} = await registeredScripts({}, outputDir);
  const {pageScript: fxPageScript} = await registeredScripts({});
  const {major: fallbackMajor, full: fallbackFull} = chromeFallbackVersion();

  async function inspectUA(ua, {useChromeBuild = true} = {}) {
    const env = createWebIDLNavigator({
      oscpu: "Windows NT 10.0; Win64; x64",
      userAgentData: {brands: [], mobile: false, platform: "Windows"}
    });
    runContentScript(useChromeBuild ? chromePageScript : fxPageScript, {
      navigator: env.navigator,
      Navigator: env.Navigator,
      NavigatorUAData: env.NavigatorUAData,
      sessionStorage: fakeStorage({"mobview-useragent": ua}),
      window: createWindow(),
      ...(useChromeBuild ? {dir} : {})
    });
    const nav = env.navigator;
    const high = nav.userAgentData
      ? structuredClone(await nav.userAgentData.getHighEntropyValues([
        "architecture", "bitness", "formFactors", "fullVersionList",
        "model", "platformVersion", "uaFullVersion", "wow64"
      ]))
      : null;
    return {nav, high};
  }

  /* Edge Android */
  {
    const {nav, high} = await inspectUA(
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.2903.86"
    );
    assert.deepEqual(structuredClone(nav.userAgentData.brands), [
      {brand: "Not/A)Brand", version: "8"},
      {brand: "Chromium", version: "131"},
      {brand: "Microsoft Edge", version: "131"}
    ]);
    assert.equal(high.uaFullVersion, "131.0.2903.86");
    assert.equal(high.mobile, true);
  }

  /* Opera */
  {
    const {nav, high} = await inspectUA(
      "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 OPR/85.0.0.0"
    );
    assert.ok(nav.userAgentData.brands.some((b) => b.brand === "Opera" && b.version === "85"));
    assert.equal(high.uaFullVersion, "85.0.0.0");
    assert.equal(high.model, "SM-A536B");
  }

  /* Samsung Internet */
  {
    const {nav, high} = await inspectUA(
      "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36"
    );
    assert.ok(nav.userAgentData.brands.some((b) => b.brand === "Samsung Internet" && b.version === "25"));
    assert.equal(high.uaFullVersion, "25.0");
  }

  /* Android WebView (; wv)) */
  {
    const {nav, high} = await inspectUA(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240305.019; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36"
    );
    assert.ok(nav.userAgentData.brands.some((b) => b.brand === "Android WebView" && b.version === "126"));
    assert.equal(nav.userAgentData.brands.some((b) => b.brand === "Google Chrome"), false);
    assert.equal(high.model, "Pixel 8");
  }

  /* Chromium-only without Chrome/ -> 2-brand list without Google Chrome */
  {
    const {nav, high} = await inspectUA(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/130.0.0.0 Safari/537.36"
    );
    assert.deepEqual(structuredClone(nav.userAgentData.brands), [
      {brand: "Not/A)Brand", version: "8"},
      {brand: "Chromium", version: "130"}
    ]);
    assert.equal(high.uaFullVersion, "130.0.0.0");
    assert.equal(high.fullVersionList.length, 2);
  }

  /* Desktop Chrome Windows WOW64 */
  {
    const {nav, high} = await inspectUA(
      "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    assert.equal(nav.platform, "Win32");
    assert.equal(nav.userAgentData.platform, "Windows");
    assert.equal(nav.userAgentData.mobile, false);
    assert.deepEqual(high.formFactors, ["Desktop"]);
    assert.equal(high.wow64, true);
    assert.equal(high.platformVersion, "10.0.0");
    assert.equal(high.architecture, "x86");
    assert.equal(high.bitness, "32");
  }

  /* Windows Firefox WOW64 oscpu */
  {
    const {nav} = await inspectUA(
      "Mozilla/5.0 (Windows NT 10.0; WOW64; rv:131.0) Gecko/20100101 Firefox/131.0",
      {useChromeBuild: false}
    );
    assert.equal(nav.oscpu, "Windows NT 10.0; WOW64");
    assert.equal(nav.platform, "Win32");
  }

  /* macOS Chrome */
  {
    const {nav, high} = await inspectUA(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    assert.equal(nav.platform, "MacIntel");
    assert.equal(nav.userAgentData.platform, "macOS");
    assert.equal(nav.userAgentData.mobile, false);
    assert.deepEqual(high.formFactors, ["Desktop"]);
    assert.equal(high.platformVersion, "10.15.7");
    assert.equal(high.architecture, "x86");
    assert.equal(high.bitness, "64");
  }

  /* Android tablet without Mobile */
  {
    const {nav, high} = await inspectUA(
      "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    assert.equal(nav.userAgentData.mobile, false);
    assert.deepEqual(high.formFactors, ["Tablet"]);
    assert.equal(high.model, "Pixel Tablet");
    assert.equal(high.platformVersion, "14.0.0");
  }

  /* extractAndroidModel skips U, locale, wv, Mobile, Tablet and strips Build/... */
  {
    const {high: galaxy} = await inspectUA(
      "Mozilla/5.0 (Linux; U; Android 14; en-us; SM-S918B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
    );
    assert.equal(galaxy.model, "SM-S918B");

    const {high: skipped} = await inspectUA(
      "Mozilla/5.0 (Linux; U; Android 14; en-us; Tablet; Mobile; wv; Pixel 7 Pro Build/TQ3A.230805.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
    );
    assert.equal(skipped.model, "Pixel 7 Pro");
  }

  /* Classic iPad UA */
  {
    const {nav} = await inspectUA(
      "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1"
    );
    assert.equal(nav.platform, "iPad");
    assert.equal(nav.vendor, "Apple Computer, Inc.");
    assert.equal(nav.maxTouchPoints, 5);
  }

  /* Bracketless Firefox UA */
  {
    const {nav} = await inspectUA("Mozilla/5.0 Gecko/20100101 Firefox/131.0", {useChromeBuild: false});
    assert.equal(nav.appVersion, "5.0 ()");
  }

  /* Linux desktop Firefox */
  {
    const {nav} = await inspectUA(
      "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      {useChromeBuild: false}
    );
    assert.equal(nav.oscpu, "Linux x86_64");
    assert.equal(nav.platform, "Linux x86_64");
  }

  /* Dynamic Chrome fallback version derived from chromeDefaults.useragent */
  {
    const {nav, high} = await inspectUA(
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/ Mobile Safari/537.36"
    );
    assert.ok(nav.userAgentData.brands.some((b) => b.brand === "Chromium" && b.version === fallbackMajor));
    assert.ok(nav.userAgentData.brands.some((b) => b.brand === "Google Chrome" && b.version === fallbackMajor));
    assert.equal(high.uaFullVersion, fallbackFull);
  }
});

test("page script omits navigator.userAgentData when isSecureContext is false", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {chrome: fxChrome, storageScript: fxStorage, pageScript: fxPage} = await registeredScripts({
    useragent: chromeDefaults.useragent
  });
  const {chrome: chChrome, storageScript: chStorage, pageScript: chPage, dir} = await registeredScripts({
    useragent: chromeDefaults.useragent
  }, outputDir);

  function createEnv(kind) {
    if (kind === "plain") {
      return {navigator: desktopNavigator()};
    }
    if (kind === "plain-with-uadata") {
      return {navigator: desktopNavigator({userAgentData: {brands: [], mobile: false, platform: "Windows"}})};
    }
    if (kind === "webidl-no-uadata") {
      return createWebIDLNavigator({oscpu: "Windows NT 10.0; Win64; x64"});
    }
    return createWebIDLNavigator({
      oscpu: "Windows NT 10.0; Win64; x64",
      userAgentData: {brands: [{brand: "Chromium", version: "120"}], mobile: false, platform: "Windows"}
    });
  }

  function assertInsecureChromeNav(nav, label) {
    assert.equal("userAgentData" in nav, false, label);
    assert.equal(nav.userAgentData, undefined, label);
    assert.equal(nav.userAgent, chromeDefaults.useragent, label);
    assert.equal(nav.platform, "Linux armv8l", label);
  }

  for (const kind of ["plain", "plain-with-uadata", "webidl-no-uadata", "webidl-with-uadata"]) {
    /* 1a. Chrome pageScript alone (fallback = chromeDefaults.useragent) */
    {
      const env = createEnv(kind);
      runContentScript(chPage, {
        navigator: env.navigator,
        Navigator: env.Navigator,
        NavigatorUAData: env.NavigatorUAData,
        sessionStorage: fakeStorage(),
        window: createWindow({isSecureContext: false}),
        dir
      });
      assertInsecureChromeNav(env.navigator, `chrome pageScript (${kind})`);
    }

    /* 1b. Firefox pageScript alone with chromeDefaults.useragent in sessionStorage */
    {
      const env = createEnv(kind);
      runContentScript(fxPage, {
        navigator: env.navigator,
        Navigator: env.Navigator,
        NavigatorUAData: env.NavigatorUAData,
        sessionStorage: fakeStorage({"mobview-useragent": chromeDefaults.useragent}),
        window: createWindow({isSecureContext: false})
      });
      assertInsecureChromeNav(env.navigator, `firefox pageScript (${kind})`);
    }

    /* 2. Paired storageScript + pageScript (both Firefox and Chrome builds) */
    for (const build of [
      {name: "firefox", chrome: fxChrome, storageScript: fxStorage, pageScript: fxPage, extra: {}},
      {name: "chrome", chrome: chChrome, storageScript: chStorage, pageScript: chPage, extra: {dir}}
    ]) {
      const env = createEnv(kind);
      const sessionStorage = fakeStorage();
      const win = createWindow({isSecureContext: false});
      runContentScript(build.pageScript, {
        navigator: env.navigator,
        Navigator: env.Navigator,
        NavigatorUAData: env.NavigatorUAData,
        sessionStorage,
        window: win,
        ...build.extra
      });
      runContentScript(build.storageScript, {
        chrome: build.chrome,
        sessionStorage,
        localStorage: fakeStorage(),
        window: win,
        ...build.extra
      });
      await settle();
      assertInsecureChromeNav(env.navigator, `${build.name} paired (${kind})`);
    }
  }
});

test("page script tolerates Array.prototype.forEach tampering during async onUA install, transition, and restore", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {context: fxContext} = loadBackground();
  const navKeys = ["userAgent", "appVersion", "platform", "vendor", "maxTouchPoints", "oscpu", "userAgentData"];
  const uaDataKeys = ["brands", "mobile", "platform", "toJSON", "getHighEntropyValues"];

  function tamperForEach(pageContext) {
    vm.runInContext('Array.prototype.forEach = function () { throw new Error("blocked"); };', pageContext);
    assert.throws(() => vm.runInContext("[1].forEach(() => {})", pageContext), {message: "blocked"});
  }

  /* 1. Starting unspoofed on an enabled cross-origin subframe (canUseFallbackImmediately: false) */
  {
    const {chrome, storageScript, pageScript, dir} = await registeredScripts({
      sites: ["naver.com"],
      useragent: chromeDefaults.useragent
    }, outputDir);
    const env = createWebIDLNavigator({oscpu: "Windows NT 10.0; Win64; x64"});
    const sessionStorage = fakeStorage();
    const win = createWindow({
      isSubframe: true,
      sameOriginTop: false,
      ancestorOrigins: ["https://m.naver.com"],
      hostname: "www.naver.com"
    });
    const pageContext = runContentScript(pageScript, {
      navigator: env.navigator,
      Navigator: env.Navigator,
      NavigatorUAData: env.NavigatorUAData,
      sessionStorage,
      window: win,
      dir
    });
    /* Cold load leaves cross-origin subframe unspoofed until storageScript confirms top origin */
    assert.equal(env.navigator.userAgent, "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0");
    tamperForEach(pageContext);

    runContentScript(storageScript, {chrome, sessionStorage, localStorage: fakeStorage(), window: win, dir});
    await settle();

    assert.equal(env.navigator.userAgent, chromeDefaults.useragent);
    assert.equal(env.navigator.platform, "Linux armv8l");
    assert.equal("userAgentData" in env.navigator, true);
    assert.equal("oscpu" in env.navigator, false);
  }

  /* 2. Switching Chrome -> Firefox via onUA */
  {
    const {chrome, storageScript, pageScript, dir} = await registeredScripts({
      useragent: fxContext.defaults.useragent
    }, outputDir);
    const env = createWebIDLNavigator({
      oscpu: "Windows NT 10.0; Win64; x64",
      userAgentData: {brands: [{brand: "Chromium", version: "120"}], mobile: false, platform: "Windows"}
    });
    const origUADataDescs = captureDescriptors(env.NavigatorUAData.prototype, uaDataKeys);
    const sessionStorage = fakeStorage();
    const win = createWindow();

    const pageContext = runContentScript(pageScript, {
      navigator: env.navigator,
      Navigator: env.Navigator,
      NavigatorUAData: env.NavigatorUAData,
      sessionStorage,
      window: win,
      dir
    });
    assert.equal(env.navigator.userAgent, chromeDefaults.useragent);
    assert.equal("userAgentData" in env.navigator, true);
    tamperForEach(pageContext);

    runContentScript(storageScript, {chrome, sessionStorage, localStorage: fakeStorage(), window: win, dir});
    await settle();

    assert.equal(env.navigator.userAgent, fxContext.defaults.useragent);
    assert.equal(env.navigator.oscpu, "Linux armv8l");
    assert.equal("userAgentData" in env.navigator, false);
    assert.equal(env.navigator.userAgentData, undefined);
    assertDescriptorsEqual(env.NavigatorUAData.prototype, origUADataDescs, uaDataKeys);
  }

  /* 3. Full applyUA("") restoration after spoofing Chrome and Firefox */
  for (const initialUA of [chromeDefaults.useragent, fxContext.defaults.useragent]) {
    const {chrome, storageScript, pageScript, dir} = await registeredScripts({sites: ["naver.com"]}, outputDir);
    const env = createWebIDLNavigator({
      oscpu: "Windows NT 10.0; Win64; x64",
      userAgentData: {brands: [{brand: "Chromium", version: "120"}], mobile: false, platform: "Windows"}
    });
    const origNavDescs = captureDescriptors(env.Navigator.prototype, navKeys);
    const origUADataDescs = captureDescriptors(env.NavigatorUAData.prototype, uaDataKeys);
    const origValues = navigatorValues(env.navigator);
    const win = createWindow({
      isSubframe: true,
      sameOriginTop: true,
      topHostname: "blog.example.com",
      hostname: "www.naver.com"
    });
    const sessionStorage = fakeStorage({"mobview-useragent": initialUA});

    const pageContext = runContentScript(pageScript, {
      navigator: env.navigator,
      Navigator: env.Navigator,
      NavigatorUAData: env.NavigatorUAData,
      sessionStorage,
      window: win,
      dir
    });
    assert.equal(env.navigator.userAgent, initialUA);
    tamperForEach(pageContext);

    runContentScript(storageScript, {chrome, sessionStorage, localStorage: fakeStorage(), window: win, dir});
    await settle();

    assertDescriptorsEqual(env.Navigator.prototype, origNavDescs, navKeys);
    assertDescriptorsEqual(env.NavigatorUAData.prototype, origUADataDescs, uaDataKeys);
    assert.deepEqual(navigatorValues(env.navigator), origValues);
    assert.equal(env.navigator.oscpu, "Windows NT 10.0; Win64; x64");
    assert.equal(env.navigator.userAgentData.mobile, false);
    assert.equal(env.navigator.userAgentData.platform, "Windows");
  }
});

test("buildUAData brands match core.parseChromiumHints for non-standard Chrome/Edge/Opera/Samsung tokens", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {pageScript, dir} = await registeredScripts({}, outputDir);
  const {context: backgroundContext} = loadBackground();

  const cases = [
    {
      ua: "Mozilla/5.0 (Linux; Android 10; K) Chrome/130beta Mobile Safari/537.36",
      expectedBrand: "Google Chrome",
      expectedVersion: "130",
      expectedFullVersion: "130beta"
    },
    {
      ua: "Mozilla/5.0 (Linux; Android 10; K) Chrome/130.0.0.0 Mobile Edg/",
      expectedBrand: "Microsoft Edge",
      expectedVersion: "130",
      expectedFullVersion: "130.0.0.0"
    },
    {
      ua: "Mozilla/5.0 (Linux; Android 10; K) Chrome/130.0.0.0 Mobile OPR/",
      expectedBrand: "Opera",
      expectedVersion: "130",
      expectedFullVersion: "130.0.0.0"
    },
    {
      ua: "Mozilla/5.0 (Linux; Android 10; K) Chrome/130.0.0.0 Mobile SamsungBrowser/",
      expectedBrand: "Samsung Internet",
      expectedVersion: "130",
      expectedFullVersion: "130.0.0.0"
    }
  ];

  for (const {ua, expectedBrand, expectedVersion, expectedFullVersion} of cases) {
    const env = createWebIDLNavigator({
      userAgentData: {brands: [], mobile: false, platform: "Windows"}
    });
    runContentScript(pageScript, {
      navigator: env.navigator,
      Navigator: env.Navigator,
      NavigatorUAData: env.NavigatorUAData,
      sessionStorage: fakeStorage({"mobview-useragent": ua}),
      window: createWindow(),
      dir
    });

    const pageBrands = structuredClone(env.navigator.userAgentData.brands);
    const coreHints = backgroundContext.core.parseChromiumHints(ua);
    assert.ok(coreHints, ua);
    assert.deepEqual(pageBrands, structuredClone(coreHints.brands), ua);
    assert.ok(pageBrands.some((b) => b.brand === "Chromium" && b.version === "130"), ua);
    assert.ok(pageBrands.some((b) => b.brand === expectedBrand && b.version === expectedVersion), ua);

    const high = structuredClone(await env.navigator.userAgentData.getHighEntropyValues(["uaFullVersion"]));
    assert.equal(high.uaFullVersion, expectedFullVersion, ua);
  }
});
