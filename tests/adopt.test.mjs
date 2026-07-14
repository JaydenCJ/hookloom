// Adoption: reverse-compiling an existing settings.json must produce a
// manifest that compiles straight back to the same hooks — the first
// `hookloom check` after adopting has to be green, or nobody migrates.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  adoptSettings,
  compile,
  diffHooks,
  parseManifest,
  renderAdopted,
} from "../dist/index.js";
import { env } from "./helpers.mjs";

const SETTINGS = {
  permissions: { allow: ["Bash(ls:*)"] },
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          { type: "command", command: "sh guard.sh", timeout: 5 },
          { type: "command", command: "sh audit.sh" },
        ],
      },
    ],
    Stop: [{ hooks: [{ type: "command", command: "sh export.sh" }] }],
  },
};

test("adopt derives readable, collision-free ids from event and command", () => {
  const adopted = adoptSettings(SETTINGS, "s.json", ".claude/settings.json");
  assert.deepEqual(
    adopted.hooks.map((h) => h.id),
    ["pre-tool-use-sh", "pre-tool-use-sh-2", "stop-sh"]
  );
});

test("adopt preserves fields verbatim and spaces priorities 10 apart per event", () => {
  const adopted = adoptSettings(SETTINGS, "s.json", ".claude/settings.json");
  const [guard, audit, stop] = adopted.hooks;
  assert.equal(guard.matcher, "Bash");
  assert.equal(guard.timeout, 5);
  assert.equal(guard.run, "sh guard.sh");
  assert.equal(audit.timeout, undefined);
  assert.equal(stop.matcher, undefined);
  assert.deepEqual(adopted.hooks.map((h) => h.priority), [10, 20, 10]);
});

test("adopted manifest round-trips: compile output equals the original hooks", () => {
  const adopted = adoptSettings(SETTINGS, "s.json", ".claude/settings.json");
  const manifest = parseManifest(renderAdopted(adopted));
  const compiled = compile(manifest, env());
  const report = diffHooks(compiled.hooks, {
    PreToolUse: SETTINGS.hooks.PreToolUse,
    Stop: SETTINGS.hooks.Stop,
  });
  assert.equal(report.clean, true, JSON.stringify(report.lines));
});

test("adopting a settings file with no hooks yields an empty manifest", () => {
  const adopted = adoptSettings({ model: "sonnet" }, "s.json", ".claude/settings.json");
  assert.deepEqual(adopted.hooks, []);
});

test("commands whose first word is exotic still get a safe id", () => {
  const adopted = adoptSettings(
    { hooks: { Stop: [{ hooks: [{ type: "command", command: "'{weird}' arg" }] }] } },
    "s.json",
    ".claude/settings.json"
  );
  assert.match(adopted.hooks[0].id, /^stop-[a-z0-9][a-z0-9._-]*$/);
});

test("renderAdopted emits valid, parseable manifest JSON with version 1", () => {
  const rendered = renderAdopted(adoptSettings(SETTINGS, "s.json", ".claude/settings.json"));
  const manifest = parseManifest(rendered);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.hooks.length, 3);
  assert.equal(rendered.endsWith("\n"), true);
});
