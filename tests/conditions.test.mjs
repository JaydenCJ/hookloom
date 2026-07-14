// `when` clause evaluation: AND semantics across keys, per-key rules, and
// the trace lines `explain` relies on. Conditions decide what lands in a
// shared settings.json, so every branch here is a correctness branch.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateWhen } from "../dist/index.js";
import { env } from "./helpers.mjs";

test("no when clause always passes with an empty trace", () => {
  const verdict = evaluateWhen(undefined, env());
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.trace, []);
});

test("platform matches when the current platform is listed", () => {
  assert.equal(evaluateWhen({ platform: ["linux", "darwin"] }, env()).ok, true);
  assert.equal(evaluateWhen({ platform: ["darwin"] }, env()).ok, false);
});

test("env requires every variable to be set AND non-empty", () => {
  assert.equal(evaluateWhen({ env: ["CI"] }, env({ env: { CI: "1" } })).ok, true);
  assert.equal(evaluateWhen({ env: ["CI"] }, env({ env: { CI: "" } })).ok, false);
  assert.equal(evaluateWhen({ env: ["CI"] }, env({ env: {} })).ok, false);
  // AND, not OR, across the listed names.
  assert.equal(evaluateWhen({ env: ["A", "B"] }, env({ env: { A: "1", B: "1" } })).ok, true);
  assert.equal(evaluateWhen({ env: ["A", "B"] }, env({ env: { A: "1" } })).ok, false);
});

test("envEquals is an exact string comparison", () => {
  const e = env({ env: { MODE: "prod" } });
  assert.equal(evaluateWhen({ envEquals: { MODE: "prod" } }, e).ok, true);
  assert.equal(evaluateWhen({ envEquals: { MODE: "production" } }, e).ok, false);
});

test("fileExists consults the injected probe, not the real filesystem", () => {
  const e = env({ files: ["tsconfig.json"] });
  assert.equal(evaluateWhen({ fileExists: ["tsconfig.json"] }, e).ok, true);
  assert.equal(evaluateWhen({ fileExists: ["Cargo.toml"] }, e).ok, false);
});

test("profile passes when any selected profile is listed (OR within the key)", () => {
  const e = env({ profiles: ["ci"] });
  assert.equal(evaluateWhen({ profile: ["ci", "release"] }, e).ok, true);
  assert.equal(evaluateWhen({ profile: ["release"] }, e).ok, false);
  assert.equal(evaluateWhen({ profile: ["ci"] }, env()).ok, false);
});

test("multiple keys AND together: one failing key fails the clause", () => {
  const e = env({ env: { CI: "1" }, files: ["package.json"] });
  assert.equal(evaluateWhen({ env: ["CI"], fileExists: ["package.json"] }, e).ok, true);
  assert.equal(evaluateWhen({ env: ["CI"], fileExists: ["missing"] }, e).ok, false);
});

test("not inverts a nested clause and composes with sibling keys", () => {
  assert.equal(evaluateWhen({ not: { env: ["CI"] } }, env()).ok, true);
  assert.equal(evaluateWhen({ not: { env: ["CI"] } }, env({ env: { CI: "1" } })).ok, false);
  const clause = { platform: ["linux"], not: { env: ["SKIP_HOOKS"] } };
  assert.equal(evaluateWhen(clause, env({ env: { CI: "1" } })).ok, true);
  assert.equal(evaluateWhen(clause, env({ env: { CI: "1", SKIP_HOOKS: "1" } })).ok, false);
});

test("the trace names each checked fact; not-wrapped lines are marked", () => {
  const verdict = evaluateWhen(
    { env: ["CI"], fileExists: ["tsconfig.json"] },
    env({ env: { CI: "1" } })
  );
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.trace, ['env "CI" is set', 'file "tsconfig.json" does not exist']);

  const negated = evaluateWhen({ not: { env: ["CI"] } }, env({ env: { CI: "1" } }));
  assert.deepEqual(negated.trace, ['not(env "CI" is set)']);
});
