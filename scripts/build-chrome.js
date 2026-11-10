const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src");
const output = path.join(root, "dist", "chrome");
const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
const backgroundScripts = manifest.background.scripts;
const worker = "service-worker.js";
const pageScript = "data/content_script/page_context/inject.js";
const defaultsScript = "lib/defaults.js";
const chromeDefaults = {
  useragent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36"
};

delete manifest.browser_specific_settings;
// The fourth component tracks revisions shipped only to Chrome.
manifest.version += ".1";
manifest.minimum_chrome_version = "119";
manifest.background = {"service_worker": worker};

fs.rmSync(output, {recursive: true, force: true});
fs.cpSync(source, output, {recursive: true});
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(path.join(output, worker), "importScripts(" + backgroundScripts.map((file) => JSON.stringify(file)).join(", ") + ");\n");

const defaults = "var defaults = " + JSON.stringify(chromeDefaults, null, 2) + ";\n";
fs.writeFileSync(path.join(output, defaultsScript), defaults);

// Supply the default at document_start while the custom setting loads from extension storage.
const inject = fs.readFileSync(path.join(source, pageScript), "utf8");
fs.writeFileSync(path.join(output, pageScript),
  "{\nconst mobviewDefaultUserAgent = (function () {\n" + defaults + "\nreturn defaults.useragent;\n})();\n" + inject + "}\n");
