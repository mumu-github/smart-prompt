const fs = require("node:fs");
const path = require("node:path");
const { parseSkillText } = require("../../../packages/shared/smart-prompt-core");

const SUPPORTED_FILES = new Set([
  "SKILL.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules"
]);

function isSupportedSkillFile(filePath) {
  const base = path.basename(filePath);
  if (SUPPORTED_FILES.has(base)) return true;
  return base.endsWith(".skill.md") || base.endsWith(".prompt.md");
}

function walkSkillFiles(rootDir, limit = 200) {
  const found = [];
  const queue = [rootDir];
  while (queue.length && found.length < limit) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git", ".omx", "target", "dist", "build"].includes(entry.name)) {
          queue.push(fullPath);
        }
      } else if (isSupportedSkillFile(fullPath)) {
        found.push(fullPath);
      }
    }
  }
  return found;
}

function importSkillFolder(folderPath) {
  const resolved = path.resolve(folderPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    const error = new Error(`Skill folder does not exist: ${folderPath}`);
    error.code = "invalid_skill_folder";
    throw error;
  }

  return walkSkillFiles(resolved).map((filePath) => {
    const body = fs.readFileSync(filePath, "utf8");
    return parseSkillText(body, "folder-import", filePath);
  }).filter(Boolean);
}

module.exports = {
  SUPPORTED_FILES,
  importSkillFolder,
  isSupportedSkillFile,
  walkSkillFiles
};
