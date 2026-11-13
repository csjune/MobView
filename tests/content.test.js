const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {SRC, loadBackground, runContentScript, fakeLocalStorage, settle} = require("./harness");
const {buildChrome, chromeDefaults} = require("../scripts/build-chrome");

const CHROME = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

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
  if (context.app.backgroundWorker) chrome.runtime.onInstalled.fire({reason: "install"});
  await settle();
  return {chrome, context, dir, storageScript: state.scripts.find((s) => !s.world), pageScript: state.scripts.find((s) => s.world === "MAIN")};
}

function navigatorValues(navigator) {
  const values = {};
  for (const key of ["userAgent", "appVersion", "platform", "vendor", "maxTouchPoints"]) values[key] = navigator[key];
  return values;
}

test("storage script writes the default user-agent", async () => {
  const {chrome, context, storageScript} = await registeredScripts({});
  const localStorage = fakeLocalStorage();
  runContentScript(storageScript, {chrome, localStorage});
  await settle();
  assert.equal(localStorage.items["mobview-useragent"], context.defaults.useragent);
});

test("storage script writes a custom user-agent", async () => {
  const {chrome, storageScript} = await registeredScripts({useragent: "UA2"});
  const localStorage = fakeLocalStorage();
  runContentScript(storageScript, {chrome, localStorage});
  await settle();
  assert.equal(localStorage.items["mobview-useragent"], "UA2");
});

test("page script matches navigator values to the default Android Firefox user-agent", async () => {
  const {context, pageScript} = await registeredScripts({});
  const navigator = desktopNavigator();
  runContentScript(pageScript, {navigator, localStorage: fakeLocalStorage({"mobview-useragent": context.defaults.useragent})});
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
  runContentScript(pageScript, {navigator, localStorage: fakeLocalStorage({"mobview-useragent": CHROME})});
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
  runContentScript(pageScript, {navigator, localStorage: fakeLocalStorage({"mobview-useragent": IPHONE})});
  const values = navigatorValues(navigator);
  assert.equal(values.platform, "iPhone");
  assert.equal(values.vendor, "Apple Computer, Inc.");
  assert.equal(values.maxTouchPoints, 5);
});

test("page script keeps the real values without a stored user-agent or storage access", async () => {
  const {pageScript} = await registeredScripts({});
  const original = navigatorValues(desktopNavigator());
  for (const localStorage of [fakeLocalStorage(), fakeLocalStorage({}, {blocked: true})]) {
    const navigator = desktopNavigator();
    runContentScript(pageScript, {navigator, localStorage});
    assert.deepEqual(navigatorValues(navigator), original);
  }
});

test("chrome page script uses mobviewDefaultUserAgent on cold load and when storage is blocked", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {pageScript, dir} = await registeredScripts({}, outputDir);
  for (const localStorage of [fakeLocalStorage(), fakeLocalStorage({}, {blocked: true})]) {
    const navigator = desktopNavigator();
    runContentScript(pageScript, {navigator, localStorage, dir});
    assert.deepEqual(navigatorValues(navigator), {
      userAgent: chromeDefaults.useragent,
      appVersion: chromeDefaults.useragent.replace(/^Mozilla\//, ""),
      platform: "Linux armv8l",
      vendor: "Google Inc.",
      maxTouchPoints: 5
    });
  }
});

test("chrome page script overrides mobviewDefaultUserAgent with custom mobview-useragent in localStorage", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {pageScript, dir} = await registeredScripts({}, outputDir);
  const navigator = desktopNavigator();
  runContentScript(pageScript, {navigator, localStorage: fakeLocalStorage({"mobview-useragent": IPHONE}), dir});
  assert.deepEqual(navigatorValues(navigator), {
    userAgent: IPHONE,
    appVersion: IPHONE.replace(/^Mozilla\//, ""),
    platform: "iPhone",
    vendor: "Apple Computer, Inc.",
    maxTouchPoints: 5
  });
});

test("chrome page script sets prototype navigator.userAgentData to undefined", async (t) => {
  const {outputDir} = buildChromeTemp(t);
  const {pageScript, dir} = await registeredScripts({}, outputDir);
  const navigator = desktopNavigator({userAgentData: {mobile: false}});
  assert.ok(navigator.userAgentData);
  runContentScript(pageScript, {navigator, localStorage: fakeLocalStorage(), dir});
  assert.equal(navigator.userAgentData, undefined);
  assert.equal(Object.hasOwn(navigator, "userAgentData"), true);
});
