const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { checkPackageSize, resolveFiles } = require("./check-package-size");

const makeFixture = (config) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "package-size-"));
  const packageDir = path.join(root, "package");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, ".size-limit.json"),
    JSON.stringify(config, null, 2),
  );

  const writeFile = (relativePath, content) => {
    const file = path.join(packageDir, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  const run = () => {
    let stdout = "";
    let stderr = "";
    const result = checkPackageSize({
      packageDir,
      stdout: { write: (message) => (stdout += message) },
      stderr: { write: (message) => (stderr += message) },
    });
    return { ...result, stdout, stderr };
  };

  return { packageDir, run, writeFile };
};

test("fails when a configured file is missing", () => {
  const fixture = makeFixture([
    { path: "dist/prod/index.js", name: "index", limit: "1 kB" },
  ]);

  const result = fixture.run();

  assert.equal(result.passed, false);
  assert.match(result.stderr, /no files matched dist\/prod\/index\.js/);
});

test("fails when a matched glob contains a zero-byte file", () => {
  const fixture = makeFixture([
    { path: "dist/prod/**/*.js", name: "all js", limit: "10 kB" },
  ]);
  fixture.writeFile("dist/prod/index.js", "console.log('ok');");
  fixture.writeFile("dist/prod/chunks/empty.js", "");

  const result = fixture.run();

  assert.equal(result.passed, false);
  assert.match(result.stderr, /1 matched file had zero bytes/);
  assert.match(result.stderr, /dist\/prod\/chunks\/empty\.js/);
});

test("fails when output exceeds its size limit", () => {
  const fixture = makeFixture([
    { path: "dist/prod/index.js", name: "index", limit: "1 B" },
  ]);
  fixture.writeFile("dist/prod/index.js", "console.log('too large');");

  const result = fixture.run();

  assert.equal(result.passed, false);
  assert.match(result.stdout, /✖ index:/);
});

test("fails when the config is empty", () => {
  const fixture = makeFixture([]);

  const result = fixture.run();

  assert.equal(result.passed, false);
  assert.match(result.stderr, /config must contain at least one entry/);
});

test("recursive globs include nested and top-level production modules", () => {
  const fixture = makeFixture([
    { path: "dist/prod/**/*.js", name: "all js", limit: "10 kB" },
  ]);
  fixture.writeFile("dist/prod/index.js", "console.log('top');");
  fixture.writeFile("dist/prod/components/dialog.js", "console.log('nested');");

  const files = resolveFiles(fixture.packageDir, "dist/prod/**/*.js").map(
    (file) => path.relative(fixture.packageDir, file).replaceAll(path.sep, "/"),
  );

  assert.deepEqual(files, [
    "dist/prod/components/dialog.js",
    "dist/prod/index.js",
  ]);
});
