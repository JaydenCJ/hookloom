// The compiler's three promises: deterministic output, priority ordering,
// and dedupe. These are the properties that stop "my settings.json" and
// "your settings.json" from diverging when compiled from the same manifest.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { compile, parseManifest } from "../dist/index.js";
import { env, hook, rawManifest } from "./helpers.mjs";

function compileHooks(hooks, opts = {}) {
  const manifest = parseManifest(rawManifest(hooks, opts.extra ?? {}));
  return compile(manifest, env(opts.env ?? {}), opts.options ?? {});
}

test("a hook compiles to the settings.json shape with full provenance", () => {
  const result = compileHooks([hook({ id: "a", timeout: 5, priority: 7 })]);
  assert.deepEqual(result.hooks, {
    PreToolUse: [
      { matcher: "Bash", hooks: [{ type: "command", command: "echo ok", timeout: 5 }] },
    ],
  });
  assert.deepEqual(result.included, [
    { id: "a", event: "PreToolUse", matcher: "Bash", priority: 7, command: "echo ok", timeout: 5 },
  ]);
});

test("optional keys are omitted, not emitted as null: timeout and matcher", () => {
  const result = compileHooks([
    hook({ id: "t" }),
    hook({ id: "s", event: "Stop", matcher: "" }),
  ]);
  assert.equal("timeout" in result.hooks.PreToolUse[0].hooks[0], false);
  assert.equal("matcher" in result.hooks.Stop[0], false);
});

test("events emit in lifecycle order; unknown events sort after, alphabetically", () => {
  const result = compileHooks([
    hook({ id: "z", event: "Zebra", matcher: "" }),
    hook({ id: "c", event: "Stop", matcher: "" }),
    hook({ id: "a2", event: "Aardvark", matcher: "" }),
    hook({ id: "a", event: "SessionStart", matcher: "" }),
    hook({ id: "b", event: "PreToolUse" }),
  ]);
  assert.deepEqual(Object.keys(result.hooks), [
    "SessionStart",
    "PreToolUse",
    "Stop",
    "Aardvark",
    "Zebra",
  ]);
});

test("lower priority runs first; equal priorities keep manifest order", () => {
  const result = compileHooks([
    hook({ id: "late", run: "echo late", priority: 90 }),
    hook({ id: "tie1", run: "echo tie1", priority: 10 }),
    hook({ id: "tie2", run: "echo tie2", priority: 10 }),
  ]);
  const commands = result.hooks.PreToolUse[0].hooks.map((h) => h.command);
  assert.deepEqual(commands, ["echo tie1", "echo tie2", "echo late"]);
});

test("matcher groups order by their most urgent member, then matcher text", () => {
  const result = compileHooks([
    hook({ id: "w", matcher: "Write", run: "echo w", priority: 50 }),
    hook({ id: "b", matcher: "Bash", run: "echo b", priority: 10 }),
    hook({ id: "r", matcher: "Read", run: "echo r", priority: 10 }),
  ]);
  const matchers = result.hooks.PreToolUse.map((g) => g.matcher);
  assert.deepEqual(matchers, ["Bash", "Read", "Write"]);
});

test("disabled hooks are excluded and reported", () => {
  const result = compileHooks([hook({ id: "off", enabled: false })]);
  assert.deepEqual(result.hooks, {});
  assert.deepEqual(result.excluded, [{ id: "off", reason: "disabled (enabled: false)" }]);
});

test("a failing when clause excludes the hook with the failing fact", () => {
  const result = compileHooks([hook({ id: "ci-only", when: { env: ["CI"] } })]);
  assert.deepEqual(result.hooks, {});
  assert.equal(result.excluded[0].id, "ci-only");
  assert.match(result.excluded[0].reason, /env "CI" is not set/);
});

test("exclusion reasons omit passing facts, including passing not() clauses", () => {
  // platform fails, the not() clause passes (SKIP is unset) — the reason
  // must name only the platform, or explain would blame a healthy condition.
  const result = compileHooks(
    [hook({ id: "mac-only", when: { platform: ["darwin"], not: { env: ["SKIP"] } } })],
    { env: { platform: "linux" } }
  );
  assert.equal(result.excluded[0].reason, 'when: platform "linux" is not in [darwin]');
});

test("identical (command, timeout) in one group dedupes, keeping the survivor", () => {
  const result = compileHooks([
    hook({ id: "keep", run: "npm run lint", priority: 10 }),
    hook({ id: "drop", run: "npm run lint", priority: 20 }),
  ]);
  assert.equal(result.hooks.PreToolUse[0].hooks.length, 1);
  assert.deepEqual(result.deduped, [
    { id: "drop", keptId: "keep", event: "PreToolUse", matcher: "Bash" },
  ]);
});

test("different timeouts or different matchers are NOT duplicates", () => {
  const timeouts = compileHooks([
    hook({ id: "a", run: "npm test", timeout: 30 }),
    hook({ id: "b", run: "npm test", timeout: 60 }),
  ]);
  assert.equal(timeouts.hooks.PreToolUse[0].hooks.length, 2);
  assert.deepEqual(timeouts.deduped, []);

  const matchers = compileHooks([
    hook({ id: "a", matcher: "Bash", run: "echo x" }),
    hook({ id: "b", matcher: "Write", run: "echo x" }),
  ]);
  assert.equal(matchers.hooks.PreToolUse.length, 2);
});

test("${VAR} resolves from manifest vars; --var overrides win", () => {
  const hooks = [hook({ id: "v", run: "${LINT} --fix" })];
  const extra = { vars: { LINT: "npm run lint" } };
  const base = compileHooks(hooks, { extra });
  assert.equal(base.hooks.PreToolUse[0].hooks[0].command, "npm run lint --fix");
  const overridden = compileHooks(hooks, { extra, options: { vars: { LINT: "eslint ." } } });
  assert.equal(overridden.hooks.PreToolUse[0].hooks[0].command, "eslint . --fix");
});

test("dedupe compares commands AFTER variable substitution", () => {
  const result = compileHooks(
    [
      hook({ id: "literal", run: "npm run lint" }),
      hook({ id: "via-var", run: "${LINT}" }),
    ],
    { extra: { vars: { LINT: "npm run lint" } } }
  );
  assert.equal(result.hooks.PreToolUse[0].hooks.length, 1);
  assert.equal(result.deduped[0].id, "via-var");
});

test("compiling twice yields deeply equal results (determinism)", () => {
  const hooks = [
    hook({ id: "a", event: "PostToolUse", matcher: "Write|Edit", run: "echo a", priority: 30 }),
    hook({ id: "b", event: "PreToolUse", run: "echo b", priority: 10 }),
    hook({ id: "c", event: "Stop", matcher: "", run: "echo c" }),
  ];
  const one = compileHooks(hooks);
  const two = compileHooks(hooks);
  assert.equal(JSON.stringify(one), JSON.stringify(two));
});
