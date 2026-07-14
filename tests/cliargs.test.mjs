// The argv parser: strict about unknown flags and malformed --var values,
// because a silently ignored flag compiles the wrong hook set.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseArgs, parseVarFlags } from "../dist/cliargs.js";

const SPECS = {
  manifest: { kind: "string" },
  profile: { kind: "repeat" },
  stdout: { kind: "boolean" },
};

test("parses command, string flag (both spellings), boolean flag", () => {
  const parsed = parseArgs(["build", "--manifest", "m.json", "--stdout"], SPECS);
  assert.equal(parsed.command, "build");
  assert.equal(parsed.flags.manifest, "m.json");
  assert.equal(parsed.flags.stdout, true);
  assert.equal(parsed.error, undefined);
  assert.equal(parseArgs(["check", "--manifest=m.json"], SPECS).flags.manifest, "m.json");
});

test("repeatable flags accumulate in order", () => {
  const parsed = parseArgs(["build", "--profile", "ci", "--profile", "release"], SPECS);
  assert.deepEqual(parsed.flags.profile, ["ci", "release"]);
});

test("an unknown flag is an error, not ignored", () => {
  const parsed = parseArgs(["build", "--proflie", "ci"], SPECS);
  assert.match(parsed.error, /--proflie/);
});

test("malformed flag usage is an error: missing value, repeats, bool=value", () => {
  assert.match(parseArgs(["build", "--manifest"], SPECS).error, /requires a value/);
  assert.match(parseArgs(["build", "--manifest", "--stdout"], SPECS).error, /requires a value/);
  assert.match(
    parseArgs(["build", "--manifest", "a", "--manifest", "b"], SPECS).error,
    /more than once/
  );
  assert.match(parseArgs(["build", "--stdout=yes"], SPECS).error, /does not take a value/);
});

test("extra positionals are collected for the caller to reject", () => {
  const parsed = parseArgs(["build", "extra"], SPECS);
  assert.deepEqual(parsed.positionals, ["extra"]);
});

test("parseVarFlags builds a map and rejects malformed entries", () => {
  assert.deepEqual(parseVarFlags(["A=1", "B=two=three"]).vars, { A: "1", B: "two=three" });
  assert.match(parseVarFlags(["NOEQUALS"]).error, /NAME=value/);
  assert.match(parseVarFlags(["9BAD=1"]).error, /not a valid variable name/);
});
