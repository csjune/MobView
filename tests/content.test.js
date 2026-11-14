const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const {SRC, loadBackground, runContentScript, fakeStorage, createWindow, settle} = require("./harness");
const {buildChrome, chromeDefaults} = require("../scripts/build-chrome");

const CHROME = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPOD = "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1";
const IPADOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

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
  return {chrome, context, dir, storageScript: state.scripts.find((s) => !s.world), pageScript: state.scripts.find((s) => s.world === "MAIN")};
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

  const {chrome, context, storageScript} = await registeredScripts({useragent: "Mozilla/5.0\r\n(Android 15)\tMobile"});
  const sessionStorage = fakeStorage();
  const localStorage = fakeStorage();
  const window = createWindow();
  const events = [];
  window.addEventListener("mobview-useragent", (event) => events.push(event.detail), true);

  runContentScript(storageScript, {chrome, sessionStorage, localStorage, window});
  await settle();

  const stored = sessionStorage.items["mobview-useragent"];
  assert.ok(
    stored === "Mozilla/5.0 (Android 15) Mobile" || stored === context.defaults.useragent,
    `expected sanitized UA, got ${JSON.stringify(stored)}`
  );
  assert.deepEqual(events, [stored]);
});

test("page script hides CustomEvent from bubble listeners and keeps UA in a private closure", async () => {
  const {chrome, storageScript, pageScript} = await registeredScripts({useragent: "Custom-Mobile-UA"});
  const navigator = desktopNavigator();
  const sessionStorage = fakeStorage();
  const localStorage = fakeStorage();
  const window = createWindow();
  const bubbleEvents = [];
  window.addEventListener("mobview-useragent", (event) => bubbleEvents.push(event.detail), false);

  runContentScript(pageScript, {navigator, sessionStorage, window});
  runContentScript(storageScript, {chrome, sessionStorage, localStorage, window});
  await settle();

  assert.deepEqual(bubbleEvents, []);
  assert.equal(navigator.userAgent, "Custom-Mobile-UA");

  sessionStorage.clear();
  window.dispatchEvent(new window.CustomEvent("mobview-useragent", {detail: "Spoofed"}));
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
    referrer: "https://blog.example.com/",
    hostname: "www.naver.com"
  });
  runContentScript(pageScript, {navigator: unenabledNav, sessionStorage: unenabledSession, window: unenabledWin});
  runContentScript(storageScript, {chrome, sessionStorage: unenabledSession, localStorage: fakeStorage(), window: unenabledWin});
  await settle();
  assert.deepEqual(navigatorValues(unenabledNav), original);
  assert.equal("mobview-useragent" in unenabledSession.items, false);

  const enabledNav = desktopNavigator();
  const enabledSession = fakeStorage();
  const enabledWin = createWindow({
    isSubframe: true,
    sameOriginTop: false,
    referrer: "https://m.naver.com/",
    hostname: "www.naver.com"
  });
  runContentScript(pageScript, {navigator: enabledNav, sessionStorage: enabledSession, window: enabledWin});
  runContentScript(storageScript, {chrome, sessionStorage: enabledSession, localStorage: fakeStorage(), window: enabledWin});
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
  const navigator = desktopNavigator({userAgentData: {mobile: false, platform: "Windows"}});
  runContentScript(pageScript, {navigator, sessionStorage: fakeStorage(), window: createWindow(), dir});

  assert.equal("userAgentData" in navigator, true);
  assert.equal(Object.hasOwn(navigator, "userAgentData"), false);
  assert.equal(navigator.userAgentData.mobile, true);
  assert.equal(navigator.userAgentData.platform, "Android");

  const brands = structuredClone(navigator.userAgentData.brands);
  assert.ok(Array.isArray(brands));
  assert.ok(brands.some((entry) => entry.brand === "Chromium" && entry.version === "157"));
  assert.ok(brands.some((entry) => entry.brand === "Google Chrome" && entry.version === "157"));
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
  assert.equal(high.uaFullVersion, "157.0.0.0");
  assert.equal(high.wow64, false);
  assert.deepEqual(high.brands, brands);
  assert.equal(high.mobile, true);
  assert.equal(high.platform, "Android");
  assert.ok(Array.isArray(high.fullVersionList));
  assert.equal(high.fullVersionList.length, brands.length);
  assert.ok(high.fullVersionList.some((entry) => entry.brand === "Chromium" && entry.version === "157.0.0.0"));
  assert.ok(high.fullVersionList.some((entry) => entry.brand === "Google Chrome" && entry.version === "157.0.0.0"));

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
