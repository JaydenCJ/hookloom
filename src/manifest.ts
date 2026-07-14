/**
 * Strict manifest loader.
 *
 * Parses `hookloom.json`, applies defaults, resolves `extends` chains and
 * rejects everything it does not understand. Strictness is the point:
 * an unknown key, a duplicated id or a negative timeout is a hard error
 * with its JSON path, because a typo that silently drops a hook from the
 * compiled settings is far worse than a failed build.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ManifestError } from "./errors.js";
import type { HookDef, Manifest, WhenClause } from "./types.js";

/** Filesystem seam so extends-resolution is testable without temp files. */
export interface ManifestIO {
  readFile(path: string): string;
  fileExists(path: string): boolean;
}

/** The real filesystem, used by the CLI. */
export const fsIO: ManifestIO = {
  readFile: (path) => readFileSync(path, "utf8"),
  fileExists: (path) => existsSync(path),
};

export const DEFAULT_TARGET = ".claude/settings.json";
export const DEFAULT_PRIORITY = 100;
export const MAX_TIMEOUT_SECONDS = 3600;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EVENT_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

const TOP_KEYS = ["version", "extends", "target", "vars", "hooks"];
const HOOK_KEYS = [
  "id",
  "event",
  "matcher",
  "run",
  "timeout",
  "priority",
  "enabled",
  "when",
  "tags",
  "description",
];
const WHEN_KEYS = ["platform", "env", "envEquals", "fileExists", "profile", "not"];
const PLATFORMS = ["linux", "darwin", "win32"];

// ---------------------------------------------------------------------------
// Typed accessors: every rejection names the JSON path of the bad value.
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectObject(value: unknown, at: string, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(value)) throw new ManifestError(at, "must be an object");
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      throw new ManifestError(`${at}.${key}`, `unknown key (expected one of: ${keys.join(", ")})`);
    }
  }
  return value;
}

function expectString(value: unknown, at: string): string {
  if (typeof value !== "string") throw new ManifestError(at, "must be a string");
  return value;
}

function expectNonEmptyString(value: unknown, at: string): string {
  const s = expectString(value, at);
  if (s.trim() === "") throw new ManifestError(at, "must be a non-empty string");
  return s;
}

/** Accept `"x"` or `["x", "y"]`; always return an array. */
function expectStringList(value: unknown, at: string): string[] {
  if (typeof value === "string") return [expectNonEmptyString(value, at)];
  if (!Array.isArray(value)) throw new ManifestError(at, "must be a string or an array of strings");
  if (value.length === 0) throw new ManifestError(at, "must not be an empty array");
  return value.map((item, i) => expectNonEmptyString(item, `${at}[${i}]`));
}

function expectBoolean(value: unknown, at: string): boolean {
  if (typeof value !== "boolean") throw new ManifestError(at, "must be true or false");
  return value;
}

function expectInteger(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ManifestError(at, "must be an integer");
  }
  return value;
}

// ---------------------------------------------------------------------------
// Section parsers.
// ---------------------------------------------------------------------------

function parseWhen(value: unknown, at: string): WhenClause {
  const raw = expectObject(value, at, WHEN_KEYS);
  const when: WhenClause = {};
  if (raw.platform !== undefined) {
    when.platform = expectStringList(raw.platform, `${at}.platform`);
    for (const [i, p] of when.platform.entries()) {
      if (!PLATFORMS.includes(p)) {
        throw new ManifestError(`${at}.platform[${i}]`, `unknown platform "${p}" (expected one of: ${PLATFORMS.join(", ")})`);
      }
    }
  }
  if (raw.env !== undefined) when.env = expectStringList(raw.env, `${at}.env`);
  if (raw.envEquals !== undefined) {
    const table = expectObject(raw.envEquals, `${at}.envEquals`, Object.keys(raw.envEquals as object));
    const out: Record<string, string> = {};
    for (const [name, v] of Object.entries(table)) {
      out[name] = expectString(v, `${at}.envEquals.${name}`);
    }
    if (Object.keys(out).length === 0) throw new ManifestError(`${at}.envEquals`, "must not be empty");
    when.envEquals = out;
  }
  if (raw.fileExists !== undefined) when.fileExists = expectStringList(raw.fileExists, `${at}.fileExists`);
  if (raw.profile !== undefined) when.profile = expectStringList(raw.profile, `${at}.profile`);
  if (raw.not !== undefined) when.not = parseWhen(raw.not, `${at}.not`);
  if (Object.keys(when).length === 0) {
    throw new ManifestError(at, "must contain at least one condition");
  }
  return when;
}

function parseHook(value: unknown, at: string, origin: string): HookDef {
  const raw = expectObject(value, at, HOOK_KEYS);

  const id = expectNonEmptyString(raw.id, `${at}.id`);
  if (!ID_PATTERN.test(id)) {
    throw new ManifestError(`${at}.id`, `"${id}" is not a valid id (letters, digits, ".", "_", "-")`);
  }

  const event = expectNonEmptyString(raw.event, `${at}.event`);
  if (!EVENT_PATTERN.test(event)) {
    throw new ManifestError(`${at}.event`, `"${event}" is not a valid event name`);
  }

  const hook: HookDef = {
    id,
    event,
    matcher: raw.matcher === undefined ? "" : expectString(raw.matcher, `${at}.matcher`),
    run: expectNonEmptyString(raw.run, `${at}.run`),
    priority: DEFAULT_PRIORITY,
    enabled: true,
    tags: [],
    origin,
    index: 0, // assigned after extends-merge
  };

  if (raw.timeout !== undefined) {
    const timeout = expectInteger(raw.timeout, `${at}.timeout`);
    if (timeout < 1 || timeout > MAX_TIMEOUT_SECONDS) {
      throw new ManifestError(`${at}.timeout`, `must be between 1 and ${MAX_TIMEOUT_SECONDS} seconds`);
    }
    hook.timeout = timeout;
  }
  if (raw.priority !== undefined) {
    const priority = expectInteger(raw.priority, `${at}.priority`);
    if (priority < 0 || priority > 9999) {
      throw new ManifestError(`${at}.priority`, "must be between 0 and 9999");
    }
    hook.priority = priority;
  }
  if (raw.enabled !== undefined) hook.enabled = expectBoolean(raw.enabled, `${at}.enabled`);
  if (raw.when !== undefined) hook.when = parseWhen(raw.when, `${at}.when`);
  if (raw.tags !== undefined) hook.tags = expectStringList(raw.tags, `${at}.tags`);
  if (raw.description !== undefined) {
    hook.description = expectNonEmptyString(raw.description, `${at}.description`);
  }
  return hook;
}

interface ParsedFile {
  extendsPaths: string[];
  target?: string;
  vars: Record<string, string>;
  hooks: HookDef[];
}

function parseFile(source: string, path: string): ParsedFile {
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch (err) {
    throw new ManifestError(path, `not valid JSON (${(err as Error).message})`);
  }
  const raw = expectObject(json, path, TOP_KEYS);

  if (raw.version === undefined) throw new ManifestError(`${path}: version`, "is required");
  if (raw.version !== 1) {
    throw new ManifestError(`${path}: version`, `unsupported manifest version ${JSON.stringify(raw.version)} (this release reads version 1)`);
  }

  const parsed: ParsedFile = { extendsPaths: [], vars: {}, hooks: [] };

  if (raw.extends !== undefined) parsed.extendsPaths = expectStringList(raw.extends, "extends");
  if (raw.target !== undefined) parsed.target = expectNonEmptyString(raw.target, "target");
  if (raw.vars !== undefined) {
    const table = expectObject(raw.vars, "vars", Object.keys(raw.vars as object));
    for (const [name, v] of Object.entries(table)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new ManifestError(`vars.${name}`, "is not a valid variable name");
      }
      parsed.vars[name] = expectString(v, `vars.${name}`);
    }
  }

  if (raw.hooks === undefined) throw new ManifestError(`${path}: hooks`, "is required");
  if (!Array.isArray(raw.hooks)) throw new ManifestError("hooks", "must be an array");
  const seen = new Set<string>();
  for (const [i, entry] of raw.hooks.entries()) {
    const hook = parseHook(entry, `hooks[${i}]`, path);
    if (seen.has(hook.id)) {
      throw new ManifestError(`hooks[${i}].id`, `duplicate id "${hook.id}" in the same manifest`);
    }
    seen.add(hook.id);
    parsed.hooks.push(hook);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Extends resolution: parent hooks first; a child hook with the same id
// replaces the parent's entry *in place*, so a project can re-pin or disable
// a team hook without reshuffling everyone else's order.
// ---------------------------------------------------------------------------

function loadResolved(path: string, io: ManifestIO, visiting: string[]): ParsedFile {
  const abs = resolve(path);
  if (visiting.includes(abs)) {
    throw new ManifestError(abs, `circular "extends" chain: ${[...visiting, abs].join(" -> ")}`);
  }
  if (!io.fileExists(abs)) throw new ManifestError(abs, "manifest file not found");

  const parsed = parseFile(io.readFile(abs), abs);
  if (parsed.extendsPaths.length === 0) return parsed;

  const merged: ParsedFile = { extendsPaths: [], vars: {}, hooks: [] };
  for (const rel of parsed.extendsPaths) {
    const parentPath = resolve(dirname(abs), rel);
    const parent = loadResolved(parentPath, io, [...visiting, abs]);
    merged.target = parent.target ?? merged.target;
    Object.assign(merged.vars, parent.vars);
    mergeHooks(merged.hooks, parent.hooks);
  }
  merged.target = parsed.target ?? merged.target;
  Object.assign(merged.vars, parsed.vars);
  mergeHooks(merged.hooks, parsed.hooks);
  return merged;
}

function mergeHooks(base: HookDef[], overlay: HookDef[]): void {
  for (const hook of overlay) {
    const existing = base.findIndex((h) => h.id === hook.id);
    if (existing >= 0) base[existing] = hook;
    else base.push(hook);
  }
}

function finalize(parsed: ParsedFile, path: string): Manifest {
  parsed.hooks.forEach((hook, i) => {
    hook.index = i;
  });
  return {
    version: 1,
    target: parsed.target ?? DEFAULT_TARGET,
    vars: parsed.vars,
    hooks: parsed.hooks,
    path,
  };
}

/** Load a manifest from disk, resolving `extends` relative to each file. */
export function loadManifest(path: string, io: ManifestIO = fsIO): Manifest {
  return finalize(loadResolved(path, io, []), resolve(path));
}

/** Parse a manifest from a string. `extends` requires an `io` to resolve
 * against; without one it is rejected rather than silently ignored. */
export function parseManifest(source: string, opts: { path?: string; io?: ManifestIO } = {}): Manifest {
  const path = opts.path ?? "<inline>";
  const parsed = parseFile(source, path);
  if (parsed.extendsPaths.length > 0) {
    if (!opts.io) {
      throw new ManifestError("extends", "cannot be resolved when parsing from a string without an io");
    }
    return loadManifest(path, opts.io);
  }
  return finalize(parsed, path);
}
