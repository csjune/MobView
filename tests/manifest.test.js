const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("package.json and manifest.json versions match", () => {
  assert.equal(pkg.version, manifest.version);
});

test("every file referenced by the extension exists", () => {
  const files = [
    ...manifest.background.scripts,
    manifest.options_ui.page,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons)
  ];
  /* icons set at runtime and content scripts registered at runtime */
  for (const state of ["ON", "OFF"]) {
    for (const size of [16, 32, 48, 64, 128]) files.push(`data/icons/${state}/${size}.png`);
  }
  const config = fs.readFileSync(path.join(SRC, "lib", "config.js"), "utf8");
  for (const match of config.matchAll(/"((?:lib|data)\/[^"]+\.js)"/g)) files.push(match[1]);

  for (const file of files) {
    assert.ok(fs.existsSync(path.join(SRC, file)), `missing ${file}`);
  }
});
