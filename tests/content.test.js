const test = require("node:test");
const assert = require("node:assert/strict");
const {loadBackground, runContentScript, fakeLocalStorage, settle} = require("./harness");

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

function desktopNavigator() {
  return Object.create({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
    appVersion: "5.0 (Windows)",
    platform: "Win32",
    vendor: "",
    maxTouchPoints: 0
  });
}

async function registeredScripts(storage) {
  const {chrome, state, context} = loadBackground({storage: {sites: ["naver.com"], ...storage}});
  await settle();
  return {chrome, context, storageScript: state.scripts.find((s) => !s.world), pageScript: state.scripts.find((s) => s.world === "MAIN")};
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

test("page script matches navigator values to an Android Chrome user-agent", async () => {
  const {chrome, context, pageScript} = await registeredScripts({});
  const navigator = desktopNavigator();
  runContentScript(pageScript, {chrome, navigator, localStorage: fakeLocalStorage({"mobview-useragent": context.defaults.useragent})});
  assert.deepEqual(navigatorValues(navigator), {
    userAgent: context.defaults.useragent,
    appVersion: context.defaults.useragent.replace(/^Mozilla\//, ""),
    platform: "Linux armv8l",
    vendor: "Google Inc.",
    maxTouchPoints: 5
  });
});

test("page script matches navigator values to an iPhone user-agent", async () => {
  const {chrome, pageScript} = await registeredScripts({});
  const navigator = desktopNavigator();
  runContentScript(pageScript, {chrome, navigator, localStorage: fakeLocalStorage({"mobview-useragent": IPHONE})});
  const values = navigatorValues(navigator);
  assert.equal(values.platform, "iPhone");
  assert.equal(values.vendor, "Apple Computer, Inc.");
  assert.equal(values.maxTouchPoints, 5);
});

test("page script keeps the real values without a stored user-agent or storage access", async () => {
  const {chrome, pageScript} = await registeredScripts({});
  const original = navigatorValues(desktopNavigator());
  for (const localStorage of [fakeLocalStorage(), fakeLocalStorage({}, {blocked: true})]) {
    const navigator = desktopNavigator();
    runContentScript(pageScript, {chrome, navigator, localStorage});
    assert.deepEqual(navigatorValues(navigator), original);
  }
});
