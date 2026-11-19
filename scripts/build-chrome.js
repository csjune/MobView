const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src");
const dist = path.join(root, "dist");
const output = path.join(dist, "chrome");
const worker = "service-worker.js";
const pageScript = "data/content_script/page_context/inject.js";
const defaultsScript = "lib/defaults.js";
const chromeDefaults = {
  useragent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36"
};

// Fourth-component revisions shipped only to Chrome for a given base version.
const CHROME_REVISIONS = {
  "0.1.1": 1
};

function resolveChromeVersion(baseVersion, revisions = CHROME_REVISIONS) {
  const hasRevision = Object.hasOwn(revisions, baseVersion);
  if (hasRevision && Number(revisions[baseVersion]) < 1) {
    throw new Error(`Invalid Chrome extension version: ${baseVersion}.${revisions[baseVersion]}`);
  }
  const version = hasRevision
    ? `${baseVersion}.${revisions[baseVersion]}`
    : String(baseVersion);
  const parts = version.split(".");
  if (
    parts.length < 1 ||
    parts.length > 4 ||
    !parts.every((part) => /^(?:0|[1-9]\d*)$/.test(part) && Number(part) <= 65535) ||
    !parts.some((part) => Number(part) > 0) ||
    (parts.length === 4 && Number(parts[3]) === 0)
  ) {
    throw new Error(`Invalid Chrome extension version: ${version}`);
  }
  return version;
}

function buildChrome({
  sourceDir = source,
  outputDir = output,
  artifactsDir = dist,
  revisions = CHROME_REVISIONS
} = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, "manifest.json"), "utf8"));
  if (!manifest.background || !Array.isArray(manifest.background.scripts) || manifest.background.scripts.length === 0) {
    throw new Error("Invalid manifest.background.scripts");
  }
  const backgroundScripts = manifest.background.scripts;

  delete manifest.browser_specific_settings;
  manifest.version = resolveChromeVersion(manifest.version, revisions);
  manifest.minimum_chrome_version = "119";
  manifest.background = {"service_worker": worker};

  // Supply the Chrome default at document_start while any custom setting loads from extension storage.
  const fallbackPattern = /^(  const fallback = )"(?:[^"\\]|\\.)*";$/m;
  const inject = fs.readFileSync(path.join(sourceDir, pageScript), "utf8");
  if (!fallbackPattern.test(inject)) {
    throw new Error(`Expected fallback declaration in ${pageScript}`);
  }
  const chromeInject = inject.replace(
    fallbackPattern,
    (_, prefix) => `${prefix}${JSON.stringify(chromeDefaults.useragent)};`
  );

  fs.rmSync(outputDir, {recursive: true, force: true});
  if (artifactsDir && fs.existsSync(artifactsDir)) {
    for (const entry of fs.readdirSync(artifactsDir, {withFileTypes: true})) {
      if (entry.isFile() && /^mobview-chrome-.*\.zip$/.test(entry.name)) {
        fs.rmSync(path.join(artifactsDir, entry.name), {force: true});
      }
    }
  }

  fs.cpSync(sourceDir, outputDir, {recursive: true});
  fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(
    path.join(outputDir, worker),
    "importScripts(" + backgroundScripts.map((file) => JSON.stringify(file)).join(", ") + ");\n"
  );

  const defaults = "var defaults = " + JSON.stringify(chromeDefaults, null, 2) + ";\n";
  fs.writeFileSync(path.join(outputDir, defaultsScript), defaults);
  fs.writeFileSync(path.join(outputDir, pageScript), chromeInject);

  return {manifest, outputDir};
}

if (require.main === module) buildChrome();

module.exports = {buildChrome, resolveChromeVersion, chromeDefaults, CHROME_REVISIONS};
