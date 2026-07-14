// End-to-end CLI runs against the compiled dist/cli.js: real processes,
// real files in a temp dir, and the exit-code contract (0 success,
// 1 drift/lint errors, 2 usage/input errors) pinned explicitly.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tempDir } from "./helpers.mjs";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return { code: err.status, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function writeManifest(dir, manifest) {
  writeFileSync(join(dir, "hookloom.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

const BASIC = {
  version: 1,
  target: "settings.json",
  hooks: [
    { id: "guard", event: "PreToolUse", matcher: "Bash", run: "sh guard.sh", timeout: 5, priority: 10 },
    { id: "fmt", event: "PostToolUse", matcher: "Write|Edit", run: "npm run format" },
  ],
};

test("--version prints the package version; --help documents every command", () => {
  const version = run(["--version"], tempDir());
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), "0.1.0");

  const help = run(["--help"], tempDir());
  assert.equal(help.code, 0);
  for (const word of ["build", "check", "explain", "lint", "adopt", "Exit codes"]) {
    assert.match(help.stdout, new RegExp(word));
  }
});

test("usage errors exit 2: no command, unknown command, flag on wrong command", () => {
  assert.equal(run([], tempDir()).code, 2);

  const unknown = run(["frobnicate"], tempDir());
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /unknown command/);

  const dir = tempDir();
  writeManifest(dir, BASIC);
  const wrongFlag = run(["lint", "--stdout"], dir);
  assert.equal(wrongFlag.code, 2);
  assert.match(wrongFlag.stderr, /--stdout is not valid for "lint"/);
});

test("input errors exit 2: missing manifest, invalid manifest with JSON path", () => {
  const missing = run(["build"], tempDir());
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /hookloom\.json/);

  const dir = tempDir();
  writeManifest(dir, { version: 1, hooks: [{ id: "x", event: "Stop" }] });
  const invalid = run(["build"], dir);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /hooks\[0\]\.run/);
});

test("build writes the target, and check is green immediately after (the CI loop)", () => {
  const dir = tempDir();
  writeManifest(dir, BASIC);
  const built = run(["build"], dir);
  assert.equal(built.code, 0);
  assert.match(built.stdout, /wrote .*settings\.json \(2 command\(s\) across 2 event\(s\)\)/);
  const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, "sh guard.sh");

  const checked = run(["check"], dir);
  assert.equal(checked.code, 0);
  assert.match(checked.stdout, /OK: .*in sync/);
});

test("build preserves unrelated settings keys and is idempotent", () => {
  const dir = tempDir();
  writeManifest(dir, BASIC);
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({ permissions: { deny: ["WebFetch"] }, model: "sonnet" }, null, 2)
  );
  assert.equal(run(["build"], dir).code, 0);
  const first = readFileSync(join(dir, "settings.json"), "utf8");
  const settings = JSON.parse(first);
  assert.deepEqual(settings.permissions, { deny: ["WebFetch"] });
  assert.equal(settings.model, "sonnet");

  const again = run(["build"], dir);
  assert.equal(again.code, 0);
  assert.match(again.stdout, /unchanged/);
  assert.equal(readFileSync(join(dir, "settings.json"), "utf8"), first);
});

test("build --stdout prints deterministic JSON without touching disk", () => {
  const dir = tempDir();
  writeManifest(dir, BASIC);
  const one = run(["build", "--stdout"], dir);
  assert.equal(one.code, 0);
  const parsed = JSON.parse(one.stdout);
  assert.equal(parsed.hooks.PostToolUse[0].matcher, "Write|Edit");
  assert.throws(() => readFileSync(join(dir, "settings.json"), "utf8"));

  const two = run(["build", "--stdout"], dir);
  assert.equal(one.stdout, two.stdout);
});

test("check exits 1 with a diff when the target does not exist", () => {
  const dir = tempDir();
  writeManifest(dir, BASIC);
  const result = run(["check"], dir);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /DRIFT: .*does not exist yet/);
  assert.match(result.stdout, /\+ "sh guard\.sh" \(timeout 5s\)/);
});

test("check catches a hand-edited target and shows the stray command", () => {
  const dir = tempDir();
  writeManifest(dir, BASIC);
  run(["build"], dir);
  const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  settings.hooks.Stop = [{ hooks: [{ type: "command", command: "curl example.test" }] }];
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2));
  const result = run(["check"], dir);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /- "curl example\.test"/);
  assert.match(result.stdout, /run "hookloom build" to regenerate/);
});

test("check respects --profile: profile hooks count as drift only when selected", () => {
  const dir = tempDir();
  writeManifest(dir, {
    ...BASIC,
    hooks: [
      ...BASIC.hooks,
      { id: "ci-only", event: "Stop", run: "sh export.sh", when: { profile: ["ci"] } },
    ],
  });
  run(["build"], dir); // built WITHOUT the profile
  assert.equal(run(["check"], dir).code, 0);
  const withProfile = run(["check", "--profile", "ci"], dir);
  assert.equal(withProfile.code, 1);
  assert.match(withProfile.stdout, /\+ "sh export\.sh"/);
});

test("build --var overrides a manifest variable end to end", () => {
  const dir = tempDir();
  writeManifest(dir, {
    version: 1,
    target: "settings.json",
    vars: { LINT: "npm run lint" },
    hooks: [{ id: "lint", event: "PostToolUse", matcher: "Write", run: "${LINT}" }],
  });
  const result = run(["build", "--stdout", "--var", "LINT=eslint --fix ."], dir);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /eslint --fix \./);
});

test("lint exits 1 on errors and 0 on warnings only", () => {
  const dir = tempDir();
  writeManifest(dir, {
    version: 1,
    hooks: [{ id: "typo", event: "PreToolUsage", run: "echo x" }],
  });
  const bad = run(["lint"], dir);
  assert.equal(bad.code, 1);
  assert.match(bad.stdout, /unknown-event/);

  writeManifest(dir, {
    version: 1,
    hooks: [{ id: "warn", event: "Stop", matcher: "Bash", run: "echo x" }],
  });
  const warned = run(["lint"], dir);
  assert.equal(warned.code, 0);
  assert.match(warned.stdout, /matcher-ignored/);
});

test("explain reports inclusions with order and exclusions with reasons", () => {
  const dir = tempDir();
  writeManifest(dir, {
    version: 1,
    hooks: [
      { id: "always", event: "PreToolUse", matcher: "Bash", run: "echo a", priority: 10 },
      { id: "gated", event: "Stop", run: "echo b", when: { fileExists: "missing.txt" } },
    ],
  });
  const result = run(["explain"], dir);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /included \(in execution order\):/);
  assert.match(result.stdout, /PreToolUse "Bash" \[10\] always -> echo a/);
  assert.match(result.stdout, /gated: when: file "missing\.txt" does not exist/);
});

test("adopt round-trips: adopt an existing file, then check is green", () => {
  const dir = tempDir();
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(
    join(dir, ".claude", "settings.json"),
    JSON.stringify(
      {
        env: { KEEP: "me" },
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "sh guard.sh", timeout: 5 }] },
          ],
          Stop: [{ hooks: [{ type: "command", command: "sh export.sh" }] }],
        },
      },
      null,
      2
    )
  );
  const adopt = run(["adopt", "--out", "hookloom.json"], dir);
  assert.equal(adopt.code, 0);
  assert.match(adopt.stdout, /adopted 2 hook\(s\)/);
  const check = run(["check"], dir);
  assert.equal(check.code, 0, check.stdout + check.stderr);
});

test("adopt prints to stdout without --out; a missing settings file exits 2", () => {
  const dir = tempDir();
  writeFileSync(
    join(dir, "settings.json"),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] } })
  );
  const result = run(["adopt", "--settings", "settings.json"], dir);
  assert.equal(result.code, 0);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.hooks[0].run, "echo done");

  const missing = run(["adopt"], tempDir());
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /settings file not found/);
});

test("check --platform makes platform-gated output reproducible anywhere", () => {
  const dir = tempDir();
  writeManifest(dir, {
    version: 1,
    target: "settings.json",
    hooks: [
      { id: "mac-only", event: "Stop", run: "say done", when: { platform: ["darwin"] } },
    ],
  });
  const asLinux = run(["build", "--stdout", "--platform", "linux"], dir);
  assert.doesNotMatch(asLinux.stdout, /say done/);
  const asMac = run(["build", "--stdout", "--platform", "darwin"], dir);
  assert.match(asMac.stdout, /say done/);
  const bad = run(["build", "--platform", "beos"], dir);
  assert.equal(bad.code, 2);
});
