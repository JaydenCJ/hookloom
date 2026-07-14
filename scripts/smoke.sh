#!/usr/bin/env bash
# Smoke test for hookloom: exercises the real CLI end to end against the
# bundled example manifests. No network, idempotent, runs from a clean
# checkout (after `npm install`). Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents every subcommand.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in build check explain lint adopt; do
  echo "$HELP" | grep -q "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Exit-code contract: unknown commands and missing manifests exit 2.
set +e
$CLI frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown command should exit 2"; }
(cd "$WORKDIR" && $CLI build) >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing manifest should exit 2"; }
set -e
echo "[smoke] exit codes ok (2 usage/input)"

# 4. Compile the bundled example project (extends + vars + conditions).
cp "$ROOT/examples/team.loom.json" "$ROOT/examples/project.loom.json" "$WORKDIR/"
touch "$WORKDIR/tsconfig.json"   # satisfies typecheck-on-edit's when.fileExists
cd "$WORKDIR"
$CLI build --manifest project.loom.json | grep -q "^wrote" || fail "build did not write the target"
[ -f .claude/settings.json ] || fail "target settings.json was not created"
grep -q "npm run format --" .claude/settings.json || fail "child var override missing from output"
grep -q "npx tsc --noEmit" .claude/settings.json || fail "fileExists-gated hook missing from output"
echo "[smoke] build ok (extends, var override, fileExists condition)"

# 5. check is green right after build, and drift is caught after a hand edit.
$CLI check --manifest project.loom.json | grep -q "^OK: .*in sync" || fail "check should be green after build"
node -e '
  const fs = require("fs");
  const s = JSON.parse(fs.readFileSync(".claude/settings.json", "utf8"));
  s.hooks.Stop = [{ hooks: [{ type: "command", command: "curl example.test" }] }];
  fs.writeFileSync(".claude/settings.json", JSON.stringify(s, null, 2));
'
set +e
DRIFT_OUT="$($CLI check --manifest project.loom.json)"; DRIFT_CODE=$?
set -e
[ "$DRIFT_CODE" -eq 1 ] || fail "hand-edited target should make check exit 1, got $DRIFT_CODE"
echo "$DRIFT_OUT" | grep -q -- '- "curl example.test"' || fail "drift diff missing the stray command"
$CLI build --manifest project.loom.json | grep -q "^wrote" || fail "rebuild after drift failed"
$CLI check --manifest project.loom.json >/dev/null || fail "check should be green after rebuild"
echo "[smoke] drift ok (edit detected, rebuild reconciles)"

# 6. Profiles change the compiled set — and check honors them symmetrically.
set +e
$CLI check --manifest project.loom.json --profile ci >/dev/null; CI_CODE=$?
set -e
[ "$CI_CODE" -eq 1 ] || fail "check --profile ci should drift against a no-profile build"
$CLI build --manifest project.loom.json --profile ci >/dev/null || fail "build --profile ci failed"
grep -q "export-transcript" .claude/settings.json || fail "profile hook missing after profile build"
$CLI check --manifest project.loom.json --profile ci | grep -q "^OK" || fail "check --profile ci should be green"
echo "[smoke] profiles ok (ci hook appears only when selected)"

# 7. explain names exclusions with their reasons.
EXPLAIN="$($CLI explain --manifest project.loom.json)"
echo "$EXPLAIN" | grep -q "included (in execution order):" || fail "explain missing included section"
echo "$EXPLAIN" | grep -q 'log-session: disabled' || fail "explain missing disabled exclusion"
echo "$EXPLAIN" | grep -q 'ci-transcript: when: profile requires one of \[ci\]' || fail "explain missing profile exclusion"
echo "[smoke] explain ok (inclusions and reasons)"

# 8. lint: the example manifest is clean; a typo'd event fails with exit 1.
$CLI lint --manifest project.loom.json | grep -q "^OK: no lint findings" || fail "example manifest should lint clean"
printf '{"version":1,"hooks":[{"id":"x","event":"PreToolUsage","run":"echo x"}]}' > bad.loom.json
set +e
LINT_OUT="$($CLI lint --manifest bad.loom.json)"; LINT_CODE=$?
set -e
[ "$LINT_CODE" -eq 1 ] || fail "lint should exit 1 on an unknown event, got $LINT_CODE"
echo "$LINT_OUT" | grep -q "unknown-event" || fail "lint output missing the unknown-event rule"
echo "[smoke] lint ok (clean pass, typo'd event fails)"

# 9. adopt: a legacy settings file round-trips to a green check.
mkdir -p adopted && cp "$ROOT/examples/legacy-settings.json" adopted/settings.json
(cd adopted && $CLI adopt --target settings.json --out hookloom.json) | grep -q "adopted 2 hook(s)" || fail "adopt count wrong"
(cd adopted && $CLI check) | grep -q "^OK: .*in sync" || fail "check should be green right after adopt"
grep -q '"PROJECT_MODE": "review"' adopted/settings.json || fail "adopt flow must not touch non-hook keys"
echo "[smoke] adopt ok (legacy file -> manifest -> green check)"

# 10. Determinism: two builds from the same inputs are byte-identical.
$CLI build --manifest project.loom.json --stdout > run1.json
$CLI build --manifest project.loom.json --stdout > run2.json
cmp -s run1.json run2.json || fail "build output is not deterministic"
echo "[smoke] determinism ok"

echo "SMOKE OK"
