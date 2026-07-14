// Lint: the checks that separate "valid JSON" from "will actually fire".
// Errors are reserved for hooks that silently never run (typo'd events,
// broken matchers, undefined variables); everything else is a warning.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { lintManifest, parseManifest } from "../dist/index.js";
import { hook, rawManifest } from "./helpers.mjs";

function lint(hooks, extra = {}) {
  return lintManifest(parseManifest(rawManifest(hooks, extra)));
}

function rules(findings, severity) {
  return findings.filter((f) => f.severity === severity).map((f) => f.rule);
}

test("a clean manifest produces no findings", () => {
  const findings = lint([
    hook({ id: "a" }),
    hook({ id: "b", event: "PostToolUse", matcher: "Write|Edit", run: "echo b" }),
  ]);
  assert.deepEqual(findings, []);
});

test("an unknown event is an error naming the known events", () => {
  const findings = lint([hook({ event: "PreToolUsage" })]);
  assert.deepEqual(rules(findings, "error"), ["unknown-event"]);
  assert.match(findings[0].message, /PreToolUse/);
});

test("a matcher on a matcherless event is a warning, not an error", () => {
  const findings = lint([hook({ event: "Stop", matcher: "Bash" })]);
  assert.deepEqual(rules(findings, "warning"), ["matcher-ignored"]);
  assert.deepEqual(rules(findings, "error"), []);
});

test("an unparseable matcher regex is an error; ${VAR} matchers are skipped", () => {
  const findings = lint([hook({ matcher: "Bash(" })]);
  assert.deepEqual(rules(findings, "error"), ["invalid-matcher"]);

  const deferred = lint([hook({ matcher: "${TOOLS}" })], { vars: { TOOLS: "Bash" } });
  assert.equal(deferred.some((f) => f.rule === "invalid-matcher"), false);
});

test("an undefined ${VAR} reference is an error", () => {
  const findings = lint([hook({ run: "${NOPE} --fix" })]);
  assert.deepEqual(rules(findings, "error"), ["undefined-var"]);
  assert.match(findings[0].message, /\$\{NOPE\}/);
});

test("unused vars warn; vars referenced only from a matcher count as used", () => {
  const unused = lint([hook()], { vars: { UNUSED: "x" } });
  assert.deepEqual(rules(unused, "warning"), ["unused-var"]);

  const used = lint([hook({ matcher: "${TOOLS}" })], { vars: { TOOLS: "Bash|Write" } });
  assert.equal(used.some((f) => f.rule === "unused-var"), false);
});

test("exact duplicates warn with both ids; disabled hooks do not participate", () => {
  const findings = lint([
    hook({ id: "first", run: "npm run lint" }),
    hook({ id: "second", run: "npm run lint" }),
  ]);
  assert.deepEqual(rules(findings, "warning"), ["duplicate-command"]);
  assert.match(findings[0].message, /"second" duplicates "first"/);

  const withDisabled = lint([
    hook({ id: "on", run: "npm run lint" }),
    hook({ id: "off", run: "npm run lint", enabled: false }),
  ]);
  assert.equal(withDisabled.some((f) => f.rule === "duplicate-command"), false);
});

test("a disabled hook gated on a profile is flagged as unreachable", () => {
  const findings = lint([
    hook({ id: "dead", enabled: false, when: { profile: ["ci"] } }),
  ]);
  assert.deepEqual(rules(findings, "warning"), ["disabled-profile-hook"]);
});

test("multiple findings accumulate across hooks", () => {
  const findings = lint([
    hook({ id: "a", event: "Sto" }),
    hook({ id: "b", run: "${GONE}" }),
  ]);
  assert.equal(findings.filter((f) => f.severity === "error").length, 2);
});
