const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {loadBackground} = require("./harness");
const {buildChrome, resolveChromeVersion} = require("../scripts/build-chrome");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

function sharedExtensionFiles(dir, targetManifest) {
  const files = [
    targetManifest.options_ui.page,
    ...Object.values(targetManifest.action.default_icon),
    ...Object.values(targetManifest.icons)
  ];
  /* icons set at runtime and content scripts registered at runtime */
  for (const state of ["ON", "OFF"]) {
    for (const size of [16, 32, 48, 64, 128]) files.push(`data/icons/${state}/${size}.png`);
  }
  const config = fs.readFileSync(path.join(dir, "lib", "config.js"), "utf8");
  for (const match of config.matchAll(/"((?:lib|data)\/[^"]+\.js)"/g)) files.push(match[1]);
  return files;
}

test("package.json and manifest.json versions match", () => {
  assert.equal(pkg.version, manifest.version);
});

test("manifest.json omits contextMenus permission", () => {
  assert.equal(manifest.permissions.includes("contextMenus"), false);
});

test("content scripts in config.js enable matchOriginAsFallback", () => {
  const {context} = loadBackground();
  const byId = Object.fromEntries(context.config.scripts.map((script) => [script.id, script]));
  assert.equal(byId["mobview-storage"].matchOriginAsFallback, true);
  assert.equal(byId["mobview-script"].matchOriginAsFallback, true);
});

test("options.html removes the test button, disables textarea autocorrect, and wires validation/live regions", () => {
  const html = fs.readFileSync(path.join(SRC, "data", "options", "options.html"), "utf8");
  assert.equal(/\bid\s*=\s*["']test["']/i.test(html), false);
  const textareaMatch = html.match(/<textarea\b[^>]*\bid\s*=\s*["']useragent["'][^>]*>/i);
  assert.ok(textareaMatch, "expected <textarea id=\"useragent\"> in options.html");
  const tag = textareaMatch[0];
  assert.match(tag, /\bautocorrect\s*=\s*["']off["']/i);
  assert.match(tag, /\bautocapitalize\s*=\s*["']none["']/i);
  assert.match(tag, /\bspellcheck\s*=\s*["']false["']/i);
  assert.match(tag, /\baria-invalid\s*=\s*["']false["']/i);
  assert.match(tag, /\bdata-error\s*=\s*["']useragent-error["']/i);
  assert.equal(/\baria-describedby\b/i.test(tag), false);

  const errorMatch = html.match(/<p\b[^>]*\bid\s*=\s*["']useragent-error["'][^>]*>/i);
  assert.ok(errorMatch, "expected <p id=\"useragent-error\"> in options.html");
  assert.match(errorMatch[0], /\bhidden(?:\s*=\s*["'][^"']*["'])?(?=[\s>])/i);

  const announcerMatch = html.match(/<[a-z0-9-]+\b[^>]*\bid\s*=\s*["']status-announcer["'][^>]*>/i);
  assert.ok(announcerMatch, "expected #status-announcer in options.html");
  assert.match(announcerMatch[0], /\baria-live\s*=\s*["']polite["']/i);
});

test("page_context Firefox fallback UA literal matches defaults.useragent", () => {
  const {context} = loadBackground();
  const inject = fs.readFileSync(path.join(SRC, "data", "content_script", "page_context", "inject.js"), "utf8");
  const firefoxMatches = [...inject.matchAll(/(["'])(Mozilla\/5\.0 \([^"'\\]*Firefox\/[^"'\\]*)\1/g)].map((m) => m[2]);
  assert.deepEqual(firefoxMatches, [context.defaults.useragent]);
});

test("root LICENSE and src/LICENSE have identical contents", () => {
  assert.equal(
    fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8"),
    fs.readFileSync(path.join(SRC, "LICENSE"), "utf8")
  );
});

test("every file referenced by the extension exists", () => {
  const files = [
    ...manifest.background.scripts,
    ...sharedExtensionFiles(SRC, manifest)
  ];

  for (const file of files) {
    assert.ok(fs.existsSync(path.join(SRC, file)), `missing ${file}`);
  }
});

test("every local asset referenced by options.html and options.css exists", () => {
  const optionsDir = path.join(SRC, "data", "options");
  const html = fs.readFileSync(path.join(optionsDir, "options.html"), "utf8");
  const css = fs.readFileSync(path.join(optionsDir, "options.css"), "utf8");

  const refs = [
    ...[...html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...css.matchAll(/url\(\s*(?:'([^']+)'|"([^"]+)"|([^)\s'"]+))\s*\)/g)].map((m) => m[1] || m[2] || m[3])
  ].filter((ref) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref));

  assert.ok(refs.length > 0, "expected local asset references in options.html/options.css");
  for (const ref of refs) {
    const cleanRef = ref.split(/[?#]/)[0];
    assert.ok(fs.existsSync(path.resolve(optionsDir, cleanRef)), `missing options asset ${ref}`);
  }
});

test("resolveChromeVersion appends Chrome revisions and rejects invalid versions", () => {
  assert.equal(resolveChromeVersion("0.1.1"), "0.1.1.1");
  assert.equal(resolveChromeVersion("0.1.2"), "0.1.2");
  for (const invalid of ["0.1.1.1.1", "0.1.70000", ""]) {
    assert.throws(() => resolveChromeVersion(invalid), /Invalid Chrome extension version/);
  }
});

test("buildChrome produces a valid Chrome output and cleans stale Chrome zips", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mobview-manifest-"));
  t.after(() => fs.rmSync(tmp, {recursive: true, force: true}));

  const outputDir = path.join(tmp, "chrome");
  const artifactsDir = path.join(tmp, "dist");
  fs.mkdirSync(artifactsDir, {recursive: true});
  fs.writeFileSync(path.join(artifactsDir, "mobview-chrome-0.0.0.zip"), "stale");
  fs.writeFileSync(path.join(artifactsDir, "mobview-0.1.1.xpi"), "keep");

  const result = buildChrome({outputDir, artifactsDir});
  assert.equal(result.outputDir, outputDir);
  assert.equal(fs.existsSync(path.join(artifactsDir, "mobview-chrome-0.0.0.zip")), false);
  assert.equal(fs.existsSync(path.join(artifactsDir, "mobview-0.1.1.xpi")), true);

  const chromeManifest = JSON.parse(fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8"));
  assert.equal(chromeManifest.manifest_version, 3);
  assert.equal(chromeManifest.minimum_chrome_version, "119");
  assert.equal("browser_specific_settings" in chromeManifest, false);
  assert.equal(chromeManifest.permissions.includes("contextMenus"), false);
  assert.ok(
    chromeManifest.version === pkg.version || chromeManifest.version.startsWith(`${pkg.version}.`),
    `expected Chrome version ${chromeManifest.version} to start with ${pkg.version}`
  );
  const parts = chromeManifest.version.split(".");
  assert.ok(parts.length >= 1 && parts.length <= 4);
  assert.ok(parts.every((part) => /^(?:0|[1-9]\d*)$/.test(part) && Number(part) <= 65535));

  const swFile = chromeManifest.background.service_worker;
  const swPath = path.join(outputDir, swFile);
  assert.ok(fs.existsSync(swPath), `missing ${swFile}`);
  const sw = fs.readFileSync(swPath, "utf8");
  const importMatch = sw.match(/importScripts\(([^)]+)\)/);
  assert.ok(importMatch, "service-worker.js should call importScripts(...)");
  const importTargets = [...importMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(importTargets.length > 0);

  const files = [
    swFile,
    ...importTargets,
    ...sharedExtensionFiles(outputDir, chromeManifest)
  ];
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(outputDir, file)), `missing ${file}`);
  }
});
