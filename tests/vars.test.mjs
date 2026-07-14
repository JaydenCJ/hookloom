// Variable substitution: the `${NAME}` compile-time form must coexist with
// runtime shell syntax (`$VAR`, `$$`), and undefined references must be
// hard errors — a hook that silently compiles to a truncated command is
// the worst possible outcome for a tool whose job is correctness.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ManifestError, referencedVars, substituteVars } from "../dist/index.js";

const VARS = { LINT: "npm run lint", DIR: "src" };

test("substitutes single and multiple ${NAME} references; plain text unchanged", () => {
  assert.equal(substituteVars("${LINT} --fix", VARS, "run"), "npm run lint --fix");
  assert.equal(substituteVars("${LINT} ${DIR}", VARS, "run"), "npm run lint src");
  assert.equal(substituteVars("echo plain", VARS, "run"), "echo plain");
});

test("runtime shell forms pass through: bare $VAR, $$ (pid), trailing $", () => {
  assert.equal(
    substituteVars('npx prettier --write "$CLAUDE_FILE_PATHS"', VARS, "run"),
    'npx prettier --write "$CLAUDE_FILE_PATHS"'
  );
  assert.equal(substituteVars("echo $$ costs 5$", VARS, "run"), "echo $$ costs 5$");
});

test("$${ escapes a literal ${ for shell brace syntax", () => {
  assert.equal(substituteVars("echo $${HOME:-/root}", VARS, "run"), "echo ${HOME:-/root}");
});

test("an undefined variable is a hard error naming the variable and path", () => {
  assert.throws(
    () => substituteVars("${MISSING}", VARS, "hooks[0].run"),
    (err) =>
      err instanceof ManifestError &&
      err.message.includes("${MISSING}") &&
      err.message.includes("hooks[0].run")
  );
});

test("malformed references are hard errors, not silent passthrough", () => {
  assert.throws(() => substituteVars("echo ${LINT", VARS, "run"), /unterminated/);
  assert.throws(() => substituteVars("echo ${not valid}", VARS, "run"), /invalid variable name/);
});

test("referencedVars finds braced names, skips shell forms and malformed input", () => {
  assert.deepEqual(referencedVars('${LINT} "$RUNTIME" $${HOME} ${DIR}'), ["LINT", "DIR"]);
  assert.deepEqual(referencedVars("echo ${oops"), []);
});
