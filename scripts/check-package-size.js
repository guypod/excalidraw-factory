#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const defaultPackageDir = path.resolve(__dirname, "../packages/excalidraw");

const parseLimit = (value) => {
  const match = /^(\d+(?:\.\d+)?)\s*(B|kB|MB)$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Unsupported size limit: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (unit === "b") {
    return amount;
  }
  if (unit === "kb") {
    return amount * 1000;
  }
  if (unit === "mb") {
    return amount * 1000 * 1000;
  }

  throw new Error(`Unsupported size unit: ${unit}`);
};

const formatSize = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

const globToRegExp = (pattern) => {
  const normalized = pattern.replaceAll(path.sep, "/");
  let source = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "*" && next === "*") {
      const after = normalized[index + 2];
      if (after === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }

  return new RegExp(`^${source}$`);
};

const listFiles = (root) => {
  const files = [];

  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  };

  if (fs.existsSync(root)) {
    visit(root);
  }

  return files;
};

const globSearchRoot = (packageDir, entryPath) => {
  const wildcardIndex = entryPath.indexOf("*");
  const prefix = entryPath.slice(0, wildcardIndex);
  const lastSlash = prefix.lastIndexOf("/");
  const root = lastSlash === -1 ? "." : prefix.slice(0, lastSlash);

  return path.join(packageDir, root);
};

const resolveFiles = (packageDir, entryPath) => {
  const absolutePattern = path.join(packageDir, entryPath);

  if (!entryPath.includes("*")) {
    if (!fs.existsSync(absolutePattern)) {
      return [];
    }

    const stat = fs.statSync(absolutePattern);
    if (stat.isDirectory()) {
      return listFiles(absolutePattern);
    }

    return [absolutePattern];
  }

  const matcher = globToRegExp(entryPath);
  const searchRoot = globSearchRoot(packageDir, entryPath);

  return listFiles(searchRoot)
    .filter((file) =>
      matcher.test(path.relative(packageDir, file).replaceAll(path.sep, "/")),
    )
    .sort();
};

const loadConfig = (configPath) =>
  JSON.parse(fs.readFileSync(configPath, "utf8"));

const checkPackageSize = ({
  packageDir = defaultPackageDir,
  configPath = path.join(packageDir, ".size-limit.json"),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) => {
  const config = loadConfig(configPath);

  if (!Array.isArray(config) || config.length === 0) {
    stderr.write("✖ size limit config must contain at least one entry\n");
    return { passed: false, results: [] };
  }

  let failed = false;
  const results = [];

  stdout.write("Package size check for @excalidraw/excalidraw\n");

  for (const entry of config) {
    const name = entry.name || entry.path;
    const matchedFiles = resolveFiles(packageDir, entry.path);
    const missingOrEmptyFiles = matchedFiles.filter(
      (file) => fs.statSync(file).size === 0,
    );

    if (matchedFiles.length === 0) {
      stderr.write(`✖ ${name}: no files matched ${entry.path}\n`);
      failed = true;
      results.push({ name, passed: false, files: [], size: 0 });
      continue;
    }

    if (missingOrEmptyFiles.length > 0) {
      stderr.write(
        `✖ ${name}: ${missingOrEmptyFiles.length} matched file${
          missingOrEmptyFiles.length === 1 ? "" : "s"
        } had zero bytes\n`,
      );
      for (const file of missingOrEmptyFiles) {
        stderr.write(`  - ${path.relative(packageDir, file)}\n`);
      }
      failed = true;
      results.push({ name, passed: false, files: matchedFiles, size: 0 });
      continue;
    }

    const size = matchedFiles.reduce((total, file) => {
      const content = fs.readFileSync(file);
      return total + zlib.gzipSync(content, { level: 9 }).length;
    }, 0);
    const limit = parseLimit(entry.limit);
    const passed = size <= limit;
    const status = passed ? "✓" : "✖";

    stdout.write(
      `${status} ${name}: ${formatSize(size)} / ${entry.limit} gzip (${
        matchedFiles.length
      } file${matchedFiles.length === 1 ? "" : "s"})\n`,
    );

    if (!passed) {
      failed = true;
    }

    results.push({ name, passed, files: matchedFiles, size, limit });
  }

  return { passed: !failed, results };
};

if (require.main === module) {
  const result = checkPackageSize();
  if (!result.passed) {
    process.exit(1);
  }
}

module.exports = {
  checkPackageSize,
  globToRegExp,
  parseLimit,
  resolveFiles,
};
