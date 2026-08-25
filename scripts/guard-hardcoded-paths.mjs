// scripts/guard-hardcoded-paths.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const IGNORE_DIRS = new Set([
  ".git",
  ".claude",
  // Historical evidence archives (conversation transcripts, change-intent audit
  // records). They quote machine-specific paths from past sessions by design and
  // must not be rewritten to satisfy this guard.
  "Doc",
  "docs",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  "tmp",
  "temp",
  "vendor",
]);

const TEXT_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs",
  ".ts", ".mts", ".cts",
  ".jsx", ".tsx",
  ".json",
  ".md", ".txt",
  ".yaml", ".yml",
  ".toml",
  ".py",
  ".ps1", ".sh", ".bat", ".cmd",
  ".html", ".css", ".scss",
]);

const ALLOWED_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

const patterns = [
  {
    name: "Windows absolute path",
    regex: /(?:^|["'`\s(=:[,])([A-Za-z]:\\(?:Users|Documents and Settings|home)\\[^"'`\r\n]+)/g,
  },
  {
    name: "Windows forward-slash absolute path",
    regex: /(?:^|["'`\s(=:[,])([A-Za-z]:\/(?:Users|Documents and Settings|home)\/[^"'`\r\n]+)/g,
  },
  {
    name: "Unix user absolute path",
    regex: /(?:^|["'`\s(=:[,])(\/(?:Users|home)\/[^"'`\r\n]+)/g,
  },
];

function shouldIgnore(relativePath) {
  const parts = relativePath.split(path.sep);
  if (parts.some((part) => IGNORE_DIRS.has(part))) {
    return true;
  }
  if (ALLOWED_FILES.has(path.basename(relativePath))) {
    return true;
  }
  return false;
}

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(ROOT, absolute);

    if (shouldIgnore(relative)) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(absolute, output);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) {
      continue;
    }

    output.push({ absolute, relative });
  }

  return output;
}

const violations = [];

for (const file of walk(ROOT)) {
  let content;
  try {
    content = fs.readFileSync(file.absolute, "utf8");
  } catch {
    continue;
  }

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        violations.push({
          file: file.relative,
          line: index + 1,
          type: pattern.name,
          value: match[1],
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("\nHARD-CODED WORKSPACE/PATH GUARD: FAIL\n");
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}\n` +
      `  ${violation.type}: ${violation.value}\n`
    );
  }
  console.error(
    "Use workspace-relative paths, configuration, environment variables, " +
    "or runtime workspace discovery instead of machine-specific paths.\n"
  );
  process.exit(1);
}

console.log("HARD-CODED WORKSPACE/PATH GUARD: PASS");