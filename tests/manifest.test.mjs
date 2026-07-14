// The strict loader: defaults, JSON-path errors, and `extends` semantics.
// The loader is the trust boundary — everything downstream assumes a
// validated manifest — so unknown keys, bad types and duplicate ids must
// all die here with a path a human can act on.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEFAULT_PRIORITY,
  DEFAULT_TARGET,
  loadManifest,
  ManifestError,
  parseManifest,
} from "../dist/index.js";
import { hook, memoryIO, rawManifest } from "./helpers.mjs";

function parseHooks(hooks, extra = {}) {
  return parseManifest(rawManifest(hooks, extra));
}

test("a minimal manifest parses with documented defaults and stable indexes", () => {
  const manifest = parseHooks([hook({ id: "a" }), hook({ id: "b" })]);
  assert.equal(manifest.target, DEFAULT_TARGET);
  const parsed = manifest.hooks[0];
  assert.equal(parsed.priority, DEFAULT_PRIORITY);
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.timeout, undefined);
  assert.deepEqual(parsed.tags, []);
  assert.deepEqual(manifest.hooks.map((h) => h.index), [0, 1]);
});

test("invalid JSON and bad versions are rejected with actionable messages", () => {
  assert.throws(
    () => parseManifest("{nope", { path: "/repo/hookloom.json" }),
    (err) => err instanceof ManifestError && err.message.includes("/repo/hookloom.json")
  );
  // A missing version would make silent format upgrades possible; forbidden.
  assert.throws(() => parseManifest(JSON.stringify({ hooks: [] })), /version/);
  assert.throws(() => parseManifest(JSON.stringify({ version: 2, hooks: [] })), /version 2/);
});

test("unknown keys are rejected by name, at the top level and inside hooks", () => {
  assert.throws(() => parseHooks([], { hoooks: [] }), /hoooks: unknown key/);
  assert.throws(() => parseHooks([hook({ prioritty: 1 })]), /hooks\[0\]\.prioritty/);
});

test("a hook without run is rejected at its path", () => {
  const bad = hook();
  delete bad.run;
  assert.throws(() => parseHooks([bad]), /hooks\[0\]\.run/);
});

test("timeout bounds are enforced: zero, negative and huge all fail", () => {
  for (const timeout of [0, -5, 3601]) {
    assert.throws(() => parseHooks([hook({ timeout })]), /timeout/);
  }
  assert.equal(parseHooks([hook({ timeout: 3600 })]).hooks[0].timeout, 3600);
});

test("invalid priorities and ids are rejected", () => {
  assert.throws(() => parseHooks([hook({ priority: 1.5 })]), /must be an integer/);
  assert.throws(() => parseHooks([hook({ id: "not ok" })]), /not a valid id/);
});

test("duplicate ids in the same manifest are rejected", () => {
  assert.throws(
    () => parseHooks([hook({ id: "dup" }), hook({ id: "dup" })]),
    /duplicate id "dup"/
  );
});

test("when clauses reject unknown keys, unknown platforms, and empty objects", () => {
  assert.throws(() => parseHooks([hook({ when: { platfrom: "linux" } })]), /platfrom/);
  assert.throws(() => parseHooks([hook({ when: { platform: "beos" } })]), /unknown platform "beos"/);
  // An empty clause would always match, silently; that is never intended.
  assert.throws(() => parseHooks([hook({ when: {} })]), /at least one condition/);
});

test("string-or-array fields accept both spellings", () => {
  const single = parseHooks([hook({ when: { env: "CI" } })]);
  const list = parseHooks([hook({ when: { env: ["CI", "DEPLOY"] } })]);
  assert.deepEqual(single.hooks[0].when.env, ["CI"]);
  assert.deepEqual(list.hooks[0].when.env, ["CI", "DEPLOY"]);
});

test("extends merges parent-first, child overrides by id in place, origin tracked", () => {
  const io = memoryIO({
    "/repo/base.loom.json": rawManifest(
      [hook({ id: "one", run: "echo base-one" }), hook({ id: "two", run: "echo base-two" })],
      { vars: { A: "base", B: "base" } }
    ),
    "/repo/hookloom.json": rawManifest(
      [hook({ id: "two", run: "echo child-two" }), hook({ id: "three", run: "echo three" })],
      { extends: ["./base.loom.json"], vars: { B: "child" } }
    ),
  });
  const manifest = loadManifest("/repo/hookloom.json", io);
  // "two" keeps the parent's slot; "three" appends after.
  assert.deepEqual(manifest.hooks.map((h) => h.id), ["one", "two", "three"]);
  assert.equal(manifest.hooks[1].run, "echo child-two");
  assert.deepEqual(manifest.vars, { A: "base", B: "child" });
  assert.equal(manifest.hooks[0].origin, "/repo/base.loom.json");
  assert.equal(manifest.hooks[1].origin, "/repo/hookloom.json");

  // The override mechanism is also how a child disables an inherited hook.
  const disabling = memoryIO({
    "/repo/base.loom.json": rawManifest([hook({ id: "noisy" })]),
    "/repo/hookloom.json": rawManifest([hook({ id: "noisy", enabled: false })], {
      extends: ["./base.loom.json"],
    }),
  });
  assert.equal(loadManifest("/repo/hookloom.json", disabling).hooks[0].enabled, false);
});

test("the child's target wins over the parent's", () => {
  const io = memoryIO({
    "/repo/base.loom.json": rawManifest([], { target: "parent.json" }),
    "/repo/child.loom.json": rawManifest([], {
      extends: ["./base.loom.json"],
      target: "child.json",
    }),
    "/repo/silent.loom.json": rawManifest([], { extends: ["./base.loom.json"] }),
  });
  assert.equal(loadManifest("/repo/child.loom.json", io).target, "child.json");
  assert.equal(loadManifest("/repo/silent.loom.json", io).target, "parent.json");
});

test("extends chains resolve relative to each file; missing files name their path", () => {
  const io = memoryIO({
    "/org/shared/base.loom.json": rawManifest([hook({ id: "shared" })]),
    "/org/team/mid.loom.json": rawManifest([], { extends: ["../shared/base.loom.json"] }),
    "/org/team/app/hookloom.json": rawManifest([], { extends: ["../mid.loom.json"] }),
  });
  const manifest = loadManifest("/org/team/app/hookloom.json", io);
  assert.deepEqual(manifest.hooks.map((h) => h.id), ["shared"]);

  const broken = memoryIO({
    "/repo/hookloom.json": rawManifest([], { extends: ["./gone.loom.json"] }),
  });
  assert.throws(
    () => loadManifest("/repo/hookloom.json", broken),
    (err) => err instanceof ManifestError && err.message.includes("/repo/gone.loom.json")
  );
});

test("a circular extends chain is a clear error, not a stack overflow", () => {
  const io = memoryIO({
    "/repo/a.loom.json": rawManifest([], { extends: ["./b.loom.json"] }),
    "/repo/b.loom.json": rawManifest([], { extends: ["./a.loom.json"] }),
  });
  assert.throws(() => loadManifest("/repo/a.loom.json", io), /circular "extends" chain/);
});
