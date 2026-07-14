/**
 * Reading, merging and rendering the target settings.json.
 *
 * hookloom owns exactly one key: `hooks`. Everything else in the file —
 * permissions, env, model, keys added by tools that do not exist yet — is
 * preserved byte-for-byte in value and in order. If `hooks` already exists
 * its position in the file is kept; otherwise it is appended. Rendering is
 * canonical (two-space indent, trailing newline), so a rebuild that changes
 * nothing writes nothing.
 */

import { ManifestError } from "./errors.js";
import type { CompiledGroup, CompiledHooks } from "./types.js";

export type SettingsObject = Record<string, unknown>;

/** Parse a settings.json source. An empty or whitespace-only file is
 * treated as `{}` — a freshly `touch`ed settings file should not crash. */
export function parseSettings(source: string, path: string): SettingsObject {
  if (source.trim() === "") return {};
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch (err) {
    throw new ManifestError(path, `not valid JSON (${(err as Error).message})`);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new ManifestError(path, "settings must be a JSON object");
  }
  return json as SettingsObject;
}

/** Return a new settings object with `hooks` replaced by the compiled value.
 * Key order is preserved; a missing `hooks` key is appended last. */
export function mergeCompiledHooks(settings: SettingsObject, compiled: CompiledHooks): SettingsObject {
  const out: SettingsObject = {};
  let placed = false;
  for (const [key, value] of Object.entries(settings)) {
    if (key === "hooks") {
      out.hooks = compiled;
      placed = true;
    } else {
      out[key] = value;
    }
  }
  if (!placed) out.hooks = compiled;
  return out;
}

/** Canonical rendering: two-space indent plus trailing newline. */
export function renderSettings(settings: SettingsObject): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/**
 * Extract the current `hooks` value in the same normalized shape the
 * compiler emits, so drift comparison is shape-to-shape. Tolerant of
 * hand-written files: a missing key is "no hooks", `matcher: ""` equals an
 * absent matcher, and unknown entry types are kept (as opaque JSON) so a
 * hand-added entry hookloom cannot express still shows up as drift.
 */
export function extractHooks(settings: SettingsObject, path: string): CompiledHooks {
  const raw = settings.hooks;
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ManifestError(`${path}: hooks`, "must be an object mapping events to matcher groups");
  }

  const out: CompiledHooks = {};
  for (const [event, groupsRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(groupsRaw)) {
      throw new ManifestError(`${path}: hooks.${event}`, "must be an array of matcher groups");
    }
    const groups: CompiledGroup[] = [];
    for (const [i, groupRaw] of groupsRaw.entries()) {
      const at = `${path}: hooks.${event}[${i}]`;
      if (typeof groupRaw !== "object" || groupRaw === null || Array.isArray(groupRaw)) {
        throw new ManifestError(at, "must be an object");
      }
      const group = groupRaw as Record<string, unknown>;
      const matcher = group.matcher;
      if (matcher !== undefined && typeof matcher !== "string") {
        throw new ManifestError(`${at}.matcher`, "must be a string");
      }
      const hooksRaw = group.hooks;
      if (!Array.isArray(hooksRaw)) {
        throw new ManifestError(`${at}.hooks`, "must be an array");
      }
      const entries = hooksRaw.map((entry, j) => normalizeEntry(entry, `${at}.hooks[${j}]`));
      const normalized: CompiledGroup = { hooks: entries };
      if (matcher !== undefined && matcher !== "") normalized.matcher = matcher;
      groups.push(normalized);
    }
    if (groups.length > 0) out[event] = groups;
  }
  return out;
}

function normalizeEntry(entry: unknown, at: string): { type: "command"; command: string; timeout?: number } {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new ManifestError(at, "must be an object");
  }
  const raw = entry as Record<string, unknown>;
  if (raw.type !== undefined && raw.type !== "command") {
    // Preserve unknown entry types as an opaque marker so they surface as
    // drift instead of being silently dropped by a rebuild.
    return { type: "command", command: `<unsupported entry type "${String(raw.type)}": ${JSON.stringify(entry)}>` };
  }
  if (typeof raw.command !== "string") {
    throw new ManifestError(`${at}.command`, "must be a string");
  }
  const out: { type: "command"; command: string; timeout?: number } = {
    type: "command",
    command: raw.command,
  };
  if (raw.timeout !== undefined) {
    if (typeof raw.timeout !== "number") throw new ManifestError(`${at}.timeout`, "must be a number");
    out.timeout = raw.timeout;
  }
  return out;
}
