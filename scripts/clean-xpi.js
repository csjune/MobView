const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

function cleanXpi({artifactsDir = dist} = {}) {
  const removed = [];
  if (artifactsDir && fs.existsSync(artifactsDir)) {
    for (const entry of fs.readdirSync(artifactsDir, {withFileTypes: true})) {
      if (entry.isFile() && /^mobview-.*\.xpi$/.test(entry.name)) {
        const target = path.join(artifactsDir, entry.name);
        fs.rmSync(target, {force: true});
        removed.push(target);
      }
    }
  }
  return removed;
}

if (require.main === module) cleanXpi();

module.exports = {cleanXpi};
