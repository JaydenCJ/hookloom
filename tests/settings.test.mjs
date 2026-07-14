// settings.json handling: hookloom owns exactly the `hooks` key and must
// leave every other byte of a team's settings file alone. These tests pin
// that contract plus the tolerant read path used for drift and adopt.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  extractHooks,
  ManifestError,
  mergeCompiledHooks,
  parseSettings,
  renderSettings,
} from "../dist/index.js";

const COMPILED = {
  PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
};

test("parse: empty file is {}, invalid JSON names the path, arrays rejected", () => {
  assert.deepEqual(parseSettings("", "s.json"), {});
  assert.deepEqual(parseSettings("  \n", "s.json"), {});
  assert.throws(
    () => parseSettings("{oops", "/repo/.claude/settings.json"),
    (err) => err instanceof ManifestError && err.message.includes("/repo/.claude/settings.json")
  );
  assert.throws(() => parseSettings("[]", "s.json"), /must be a JSON object/);
});

test("merge preserves unrelated keys and their order", () => {
  const settings = parseSettings(
    JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] }, hooks: {}, env: { FOO: "1" } }),
    "s.json"
  );
  const merged = mergeCompiledHooks(settings, COMPILED);
  assert.deepEqual(Object.keys(merged), ["permissions", "hooks", "env"]);
  assert.deepEqual(merged.permissions, { allow: ["Bash(ls:*)"] });
  assert.deepEqual(merged.hooks, COMPILED);

  // When the key was absent it is appended last, after the existing keys.
  const appended = mergeCompiledHooks({ model: "sonnet" }, COMPILED);
  assert.deepEqual(Object.keys(appended), ["model", "hooks"]);
});

test("render is canonical and merge-then-render round-trips byte-identically", () => {
  assert.equal(renderSettings({ hooks: {} }), '{\n  "hooks": {}\n}\n');
  const first = renderSettings(mergeCompiledHooks({ env: { A: "1" } }, COMPILED));
  const second = renderSettings(mergeCompiledHooks(parseSettings(first, "s.json"), COMPILED));
  assert.equal(first, second);
});

test('extractHooks: missing key is {}; matcher "" equals an absent matcher', () => {
  assert.deepEqual(extractHooks({ model: "sonnet" }, "s.json"), {});
  const settings = {
    hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo done" }] }] },
  };
  const extracted = extractHooks(settings, "s.json");
  assert.equal("matcher" in extracted.Stop[0], false);
});

test("extractHooks accepts entries without an explicit type field", () => {
  const settings = { hooks: { Stop: [{ hooks: [{ command: "echo done" }] }] } };
  const extracted = extractHooks(settings, "s.json");
  assert.deepEqual(extracted.Stop[0].hooks, [{ type: "command", command: "echo done" }]);
});

test("extractHooks rejects a malformed hooks value with a JSON path", () => {
  assert.throws(() => extractHooks({ hooks: [] }, "s.json"), /must be an object/);
  assert.throws(
    () => extractHooks({ hooks: { Stop: [{ hooks: [{ command: 42 }] }] } }, "s.json"),
    /hooks\.Stop\[0\]\.hooks\[0\]\.command/
  );
});

test("unknown entry types are preserved as opaque drift markers, not dropped", () => {
  const settings = {
    hooks: { Stop: [{ hooks: [{ type: "prompt", text: "hi" }] }] },
  };
  const extracted = extractHooks(settings, "s.json");
  assert.match(extracted.Stop[0].hooks[0].command, /unsupported entry type "prompt"/);
});
