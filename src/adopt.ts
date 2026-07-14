/**
 * Adoption: reverse-compile an existing settings.json into a manifest.
 *
 * Teams do not start from a blank file — they start from a settings.json
 * that three people have hand-edited for months. `hookloom adopt` turns
 * that file's `hooks` key into a manifest that compiles back to the exact
 * same hooks, so the very first `hookloom check` after adoption is green.
 * Priorities are spaced 10 apart in file order and ids are derived from the
 * event and the command's first word, so the generated manifest is
 * something a human can immediately start editing.
 */

import { extractHooks, type SettingsObject } from "./settings.js";

export interface AdoptedManifest {
  version: 1;
  target: string;
  hooks: Array<{
    id: string;
    event: string;
    matcher?: string;
    run: string;
    timeout?: number;
    priority: number;
  }>;
}

/** Build a manifest object (ready to serialize) from a settings object. */
export function adoptSettings(settings: SettingsObject, settingsPath: string, target: string): AdoptedManifest {
  const hooks = extractHooks(settings, settingsPath);
  const manifest: AdoptedManifest = { version: 1, target, hooks: [] };
  const usedIds = new Set<string>();

  for (const [event, groups] of Object.entries(hooks)) {
    let priority = 10;
    for (const group of groups) {
      for (const entry of group.hooks) {
        const hook: AdoptedManifest["hooks"][number] = {
          id: uniqueId(idFor(event, entry.command), usedIds),
          event,
          run: entry.command,
          priority,
        };
        if (group.matcher !== undefined && group.matcher !== "") hook.matcher = group.matcher;
        if (entry.timeout !== undefined) hook.timeout = entry.timeout;
        manifest.hooks.push(hook);
        priority += 10;
      }
    }
  }
  return manifest;
}

/** `PostToolUse` + `npx prettier --write ...` -> `post-tool-use-npx`. */
function idFor(event: string, command: string): string {
  const eventSlug = event
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  const word = (command.trim().split(/\s+/)[0] ?? "run")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .toLowerCase();
  const commandSlug = word === "" || /^[._-]/.test(word) ? "run" : word;
  return `${eventSlug}-${commandSlug}`;
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

/** Serialize with the field order humans expect to read. */
export function renderAdopted(manifest: AdoptedManifest): string {
  const hooks = manifest.hooks.map((hook) => {
    const entry: Record<string, unknown> = { id: hook.id, event: hook.event };
    if (hook.matcher !== undefined) entry.matcher = hook.matcher;
    entry.run = hook.run;
    if (hook.timeout !== undefined) entry.timeout = hook.timeout;
    entry.priority = hook.priority;
    return entry;
  });
  return `${JSON.stringify({ version: 1, target: manifest.target, hooks }, null, 2)}\n`;
}
