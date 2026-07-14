// Shared factories for the hookloom test suite. Everything is deterministic:
// fixed platform/env values, in-memory file maps instead of the real
// filesystem, and temp dirs only in the CLI integration tests.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A raw manifest object ready for JSON.stringify / parseManifest. */
export function rawManifest(hooks, extra = {}) {
  return JSON.stringify({ version: 1, hooks, ...extra });
}

/** A minimal valid hook declaration; override any field. */
export function hook(overrides = {}) {
  return {
    id: "sample",
    event: "PreToolUse",
    matcher: "Bash",
    run: "echo ok",
    ...overrides,
  };
}

/** A fixed compile environment; override any field. `files` is the set of
 * paths `when.fileExists` finds. */
export function env(overrides = {}) {
  const files = new Set(overrides.files ?? []);
  return {
    platform: "linux",
    env: {},
    fileExists: (path) => files.has(path),
    profiles: [],
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "files")),
  };
}

/** An in-memory ManifestIO over a { path: source } map. */
export function memoryIO(files) {
  return {
    readFile: (path) => {
      if (!(path in files)) throw new Error(`no such file: ${path}`);
      return files[path];
    },
    fileExists: (path) => path in files,
  };
}

/** A fresh temp directory for CLI tests. */
export function tempDir() {
  return mkdtempSync(join(tmpdir(), "hookloom-test-"));
}
