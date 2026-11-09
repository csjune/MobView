const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src");
const output = path.join(root, "dist", "chrome");
const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
const backgroundScripts = manifest.background.scripts;
const worker = "service-worker.js";
const pageScript = "data/content_script/page_context/inject.js";

delete manifest.browser_specific_settings;
manifest.minimum_chrome_version = "119";
manifest.background = {"service_worker": worker};

fs.rmSync(output, {recursive: true, force: true});
fs.cpSync(source, output, {recursive: true});
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(path.join(output, worker), "importScripts(" + backgroundScripts.map((file) => JSON.stringify(file)).join(", ") + ");\n");

// Supply the default at document_start while the custom setting loads from extension storage.
const defaults = fs.readFileSync(path.join(source, "lib/defaults.js"), "utf8");
const inject = fs.readFileSync(path.join(source, pageScript), "utf8");
fs.writeFileSync(path.join(output, pageScript),
  "{\nconst mobviewDefaultUserAgent = (function () {\n" + defaults + "\nreturn defaults.useragent;\n})();\n" + inject + "}\n");
