#!/usr/bin/env node
/**
 * The hookloom CLI: build / check / explain / lint / adopt.
 *
 * Exit-code contract (stable API):
 *   0  success — built, in sync, or no lint errors
 *   1  findings — drift detected, or lint errors
 *   2  usage or input errors — bad flags, unreadable files, invalid manifest
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { adoptSettings, renderAdopted } from "./adopt.js";
import { parseArgs, parseVarFlags, type FlagSpec } from "./cliargs.js";
import { compile, type CompileOptions } from "./compile.js";
import { diffHooks, renderDrift } from "./drift.js";
import { ManifestError } from "./errors.js";
import { lintManifest } from "./lint.js";
import { loadManifest } from "./manifest.js";
import { extractHooks, mergeCompiledHooks, parseSettings, renderSettings } from "./settings.js";
import type { CompileEnv, CompileResult, Manifest } from "./types.js";
import { VERSION } from "./version.js";

const USAGE = `hookloom ${VERSION} — compile a declarative hook manifest into settings.json

Usage: hookloom <command> [flags]

Commands:
  build     compile the manifest and write the target settings file
  check     compile in memory and diff against the target (CI mode)
  explain   show what compiles, what is excluded and why, and the order
  lint      validate the manifest beyond what the parser enforces
  adopt     generate a manifest from an existing settings file

Flags:
  --manifest <path>   manifest file (default: hookloom.json)
  --target <path>     override the manifest's target settings file
  --profile <name>    select a profile (repeatable)
  --var NAME=value    define/override a variable (repeatable)
  --platform <name>   compile as linux / darwin / win32 (default: this machine)
  --stdout            build: print the settings JSON instead of writing
  --settings <path>   adopt: settings file to read (default: the target)
  --out <path>        adopt: write the manifest here instead of stdout
  --version           print the version
  --help              print this help

Exit codes: 0 success · 1 drift or lint errors · 2 usage/input errors`;

const FLAG_SPECS: Record<string, FlagSpec> = {
  manifest: { kind: "string" },
  target: { kind: "string" },
  profile: { kind: "repeat" },
  var: { kind: "repeat" },
  platform: { kind: "string" },
  stdout: { kind: "boolean" },
  settings: { kind: "string" },
  out: { kind: "string" },
  version: { kind: "boolean" },
  help: { kind: "boolean" },
};

const COMMAND_FLAGS: Record<string, string[]> = {
  build: ["manifest", "target", "profile", "var", "platform", "stdout"],
  check: ["manifest", "target", "profile", "var", "platform"],
  explain: ["manifest", "target", "profile", "var", "platform"],
  lint: ["manifest"],
  adopt: ["manifest", "target", "settings", "out"],
};

interface Io {
  out(line: string): void;
  err(line: string): void;
}

const realIo: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

// ---------------------------------------------------------------------------
// Shared plumbing.
// ---------------------------------------------------------------------------

function resolveFrom(base: string, path: string): string {
  return isAbsolute(path) ? path : resolve(base, path);
}

interface LoadedContext {
  manifest: Manifest;
  manifestDir: string;
  targetPath: string;
}

function loadContext(flags: Record<string, unknown>): LoadedContext {
  const manifestPath = resolve(typeof flags.manifest === "string" ? flags.manifest : "hookloom.json");
  const manifest = loadManifest(manifestPath);
  const manifestDir = dirname(manifestPath);
  const target = typeof flags.target === "string" ? flags.target : manifest.target;
  return { manifest, manifestDir, targetPath: resolveFrom(manifestDir, target) };
}

function buildEnv(
  flags: Record<string, unknown>,
  manifestDir: string
): { ok: true; env: CompileEnv } | { ok: false; error: string } {
  const platform = typeof flags.platform === "string" ? flags.platform : process.platform;
  if (!["linux", "darwin", "win32"].includes(platform)) {
    return { ok: false, error: `--platform: unknown platform "${platform}"` };
  }
  return {
    ok: true,
    env: {
      platform,
      env: process.env,
      fileExists: (path) => existsSync(resolveFrom(manifestDir, path)),
      profiles: Array.isArray(flags.profile) ? (flags.profile as string[]) : [],
    },
  };
}

function buildOptions(flags: Record<string, unknown>): { options: CompileOptions; error?: string } {
  const raw = Array.isArray(flags.var) ? (flags.var as string[]) : [];
  const { vars, error } = parseVarFlags(raw);
  if (error) return { options: {}, error };
  return { options: { vars } };
}

function summary(result: CompileResult): string {
  const events = Object.keys(result.hooks).length;
  return `${result.included.length} command(s) across ${events} event(s)`;
}

// ---------------------------------------------------------------------------
// Commands.
// ---------------------------------------------------------------------------

function cmdBuild(flags: Record<string, unknown>, io: Io): number {
  const ctx = loadContext(flags);
  const envResult = buildEnv(flags, ctx.manifestDir);
  if (!envResult.ok) return usageError(envResult.error, io);
  const env = envResult.env;
  const { options, error: varError } = buildOptions(flags);
  if (varError) return usageError(varError, io);

  const result = compile(ctx.manifest, env, options);

  const existingSource = existsSync(ctx.targetPath) ? readFileSync(ctx.targetPath, "utf8") : "";
  const settings = parseSettings(existingSource, ctx.targetPath);
  const merged = mergeCompiledHooks(settings, result.hooks);
  const rendered = renderSettings(merged);

  if (flags.stdout === true) {
    io.out(rendered.trimEnd());
    return 0;
  }

  if (rendered === existingSource) {
    io.out(`unchanged ${ctx.targetPath} (${summary(result)}, already in sync)`);
    return 0;
  }
  mkdirSync(dirname(ctx.targetPath), { recursive: true });
  writeFileSync(ctx.targetPath, rendered);
  io.out(`wrote ${ctx.targetPath} (${summary(result)})`);
  for (const drop of result.deduped) {
    io.err(`note: hook "${drop.id}" deduplicated into "${drop.keptId}"`);
  }
  return 0;
}

function cmdCheck(flags: Record<string, unknown>, io: Io): number {
  const ctx = loadContext(flags);
  const envResult = buildEnv(flags, ctx.manifestDir);
  if (!envResult.ok) return usageError(envResult.error, io);
  const env = envResult.env;
  const { options, error: varError } = buildOptions(flags);
  if (varError) return usageError(varError, io);

  const result = compile(ctx.manifest, env, options);

  if (!existsSync(ctx.targetPath)) {
    io.out(`DRIFT: ${ctx.targetPath} does not exist yet`);
    const report = diffHooks(result.hooks, {});
    for (const line of renderDrift(report)) io.out(line);
    io.out(`run "hookloom build" to generate it`);
    return 1;
  }

  const settings = parseSettings(readFileSync(ctx.targetPath, "utf8"), ctx.targetPath);
  const actual = extractHooks(settings, ctx.targetPath);
  const report = diffHooks(result.hooks, actual);

  if (report.clean) {
    io.out(`OK: ${ctx.targetPath} is in sync with ${ctx.manifest.path} (${summary(result)})`);
    return 0;
  }

  io.out(`DRIFT: ${ctx.targetPath} does not match ${ctx.manifest.path}`);
  for (const line of renderDrift(report)) io.out(line);
  io.out(`run "hookloom build" to regenerate`);
  return 1;
}

function cmdExplain(flags: Record<string, unknown>, io: Io): number {
  const ctx = loadContext(flags);
  const envResult = buildEnv(flags, ctx.manifestDir);
  if (!envResult.ok) return usageError(envResult.error, io);
  const env = envResult.env;
  const { options, error: varError } = buildOptions(flags);
  if (varError) return usageError(varError, io);

  const result = compile(ctx.manifest, env, options);

  io.out(`manifest: ${ctx.manifest.path} (${ctx.manifest.hooks.length} hook(s) declared)`);
  io.out(`target:   ${ctx.targetPath}`);
  io.out(`platform: ${env.platform}   profiles: ${env.profiles.length > 0 ? env.profiles.join(", ") : "(none)"}`);
  io.out(`compiled: ${summary(result)}`);

  if (result.included.length > 0) {
    io.out("");
    io.out("included (in execution order):");
    for (const hook of result.included) {
      const matcher = hook.matcher === "" ? "" : ` "${hook.matcher}"`;
      const timeout = hook.timeout !== undefined ? ` (timeout ${hook.timeout}s)` : "";
      io.out(`  ${hook.event}${matcher} [${hook.priority}] ${hook.id} -> ${hook.command}${timeout}`);
    }
  }
  if (result.excluded.length > 0) {
    io.out("");
    io.out("excluded:");
    for (const hook of result.excluded) {
      io.out(`  ${hook.id}: ${hook.reason}`);
    }
  }
  if (result.deduped.length > 0) {
    io.out("");
    io.out("deduplicated:");
    for (const drop of result.deduped) {
      const matcher = drop.matcher === "" ? "" : ` "${drop.matcher}"`;
      io.out(`  ${drop.id} collapses into ${drop.keptId} (${drop.event}${matcher})`);
    }
  }
  return 0;
}

function cmdLint(flags: Record<string, unknown>, io: Io): number {
  const ctx = loadContext(flags);
  const findings = lintManifest(ctx.manifest);
  if (findings.length === 0) {
    io.out(`OK: no lint findings (${ctx.manifest.hooks.length} hook(s))`);
    return 0;
  }
  let errors = 0;
  for (const finding of findings) {
    if (finding.severity === "error") errors += 1;
    io.out(`${finding.severity.padEnd(7)} ${finding.rule.padEnd(22)} ${finding.message}`);
  }
  io.out(`${findings.length} finding(s): ${errors} error(s), ${findings.length - errors} warning(s)`);
  return errors > 0 ? 1 : 0;
}

function cmdAdopt(flags: Record<string, unknown>, io: Io): number {
  // adopt works without an existing manifest: derive the target from flags
  // or the default, then reverse-compile the settings file.
  const manifestPath = resolve(typeof flags.manifest === "string" ? flags.manifest : "hookloom.json");
  const manifestDir = dirname(manifestPath);
  const target = typeof flags.target === "string" ? flags.target : ".claude/settings.json";
  const settingsPath =
    typeof flags.settings === "string"
      ? resolveFrom(manifestDir, flags.settings)
      : resolveFrom(manifestDir, target);

  if (!existsSync(settingsPath)) {
    io.err(`hookloom: settings file not found: ${settingsPath}`);
    return 2;
  }
  const settings = parseSettings(readFileSync(settingsPath, "utf8"), settingsPath);
  const adopted = adoptSettings(settings, settingsPath, target);
  const rendered = renderAdopted(adopted);

  if (typeof flags.out === "string") {
    const outPath = resolveFrom(manifestDir, flags.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, rendered);
    io.out(`adopted ${adopted.hooks.length} hook(s) from ${settingsPath} -> ${outPath}`);
  } else {
    io.out(rendered.trimEnd());
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

function usageError(message: string, io: Io): number {
  io.err(`hookloom: ${message}`);
  io.err(`try "hookloom --help"`);
  return 2;
}

export function runCli(argv: string[], io: Io = realIo): number {
  const parsed = parseArgs(argv, FLAG_SPECS);
  if (parsed.error) return usageError(parsed.error, io);

  if (parsed.flags.version === true) {
    io.out(VERSION);
    return 0;
  }
  if (parsed.flags.help === true || parsed.command === null) {
    io.out(USAGE);
    return parsed.command === null && parsed.flags.help !== true ? 2 : 0;
  }

  const allowed = COMMAND_FLAGS[parsed.command];
  if (allowed === undefined) {
    return usageError(`unknown command "${parsed.command}"`, io);
  }
  if (parsed.positionals.length > 0) {
    return usageError(`unexpected argument "${parsed.positionals[0]}"`, io);
  }
  for (const flag of Object.keys(parsed.flags)) {
    if (!allowed.includes(flag)) {
      return usageError(`--${flag} is not valid for "${parsed.command}"`, io);
    }
  }

  try {
    switch (parsed.command) {
      case "build":
        return cmdBuild(parsed.flags, io);
      case "check":
        return cmdCheck(parsed.flags, io);
      case "explain":
        return cmdExplain(parsed.flags, io);
      case "lint":
        return cmdLint(parsed.flags, io);
      case "adopt":
        return cmdAdopt(parsed.flags, io);
      default:
        return usageError(`unknown command "${parsed.command}"`, io);
    }
  } catch (err) {
    if (err instanceof ManifestError) {
      io.err(`hookloom: ${err.message}`);
      return 2;
    }
    throw err;
  }
}

process.exitCode = runCli(process.argv.slice(2));
