// Drift detection: the comparison must be structural (formatting is not
// drift), order-sensitive (hook order is execution order), and symmetric
// (manifest ahead of file and file ahead of manifest both surface).
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { diffHooks, renderDrift } from "../dist/index.js";

function cmd(command, timeout) {
  return timeout === undefined
    ? { type: "command", command }
    : { type: "command", command, timeout };
}

test("identical hooks — and two empty sides — report clean", () => {
  const hooks = { PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo a", 5)] }] };
  const report = diffHooks(hooks, hooks);
  assert.equal(report.clean, true);
  assert.deepEqual(report.lines, []);
  assert.equal(diffHooks({}, {}).clean, true);
});

test("drift is symmetric: manifest-only commands are +, file-only are -", () => {
  const ahead = diffHooks(
    { PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo new")] }] },
    {}
  );
  assert.equal(ahead.clean, false);
  assert.deepEqual(ahead.lines, [
    { kind: "+", event: "PreToolUse", matcher: "Bash", detail: '"echo new"' },
  ]);

  const behind = diffHooks({}, { Stop: [{ hooks: [cmd("say done")] }] });
  assert.deepEqual(behind.lines, [
    { kind: "-", event: "Stop", matcher: "", detail: '"say done"' },
  ]);
});

test("a changed timeout shows as both + and - (it is a different entry)", () => {
  const report = diffHooks(
    { PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo a", 10)] }] },
    { PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo a", 5)] }] }
  );
  const kinds = report.lines.map((l) => l.kind).sort();
  assert.deepEqual(kinds, ["+", "-"]);
  assert.match(report.lines[0].detail, /timeout 10s/);
});

test("same commands in a different order is drift (~ line)", () => {
  const report = diffHooks(
    { PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo a"), cmd("echo b")] }] },
    { PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo b"), cmd("echo a")] }] }
  );
  assert.equal(report.clean, false);
  assert.equal(report.lines[0].kind, "~");
  assert.match(report.lines[0].detail, /order differs/);
});

test("matcher spelled \"\" vs omitted, and split groups, normalize before compare", () => {
  const emptyVsOmitted = diffHooks(
    { Stop: [{ hooks: [cmd("echo done")] }] },
    { Stop: [{ matcher: undefined, hooks: [cmd("echo done")] }] }
  );
  assert.equal(emptyVsOmitted.clean, true);

  // A hand-edited file sometimes has two groups for the same matcher; the
  // combined command sequence is what actually runs, so compare that.
  const split = diffHooks(
    { PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo a"), cmd("echo b")] }] },
    {
      PreToolUse: [
        { matcher: "Bash", hooks: [cmd("echo a")] },
        { matcher: "Bash", hooks: [cmd("echo b")] },
      ],
    }
  );
  assert.equal(split.clean, true);
});

test("drift lines cover multiple events in lifecycle order", () => {
  const report = diffHooks(
    {
      Stop: [{ hooks: [cmd("echo stop")] }],
      SessionStart: [{ hooks: [cmd("echo start")] }],
    },
    {}
  );
  assert.deepEqual(report.lines.map((l) => l.event), ["SessionStart", "Stop"]);
});

test("renderDrift groups lines under an event/matcher header", () => {
  const report = diffHooks(
    { PreToolUse: [{ matcher: "Bash", hooks: [cmd("echo a"), cmd("echo b")] }] },
    {}
  );
  assert.deepEqual(renderDrift(report), [
    '  PreToolUse / "Bash":',
    '    + "echo a"',
    '    + "echo b"',
  ]);
});
