/**
 * Public programmatic API.
 *
 * Everything the CLI does is reachable as a library: load and validate a
 * manifest, compile it against an explicit environment, diff against a
 * settings object, lint, and adopt. All functions are pure given their
 * inputs (the filesystem enters only through the injectable `ManifestIO`
 * and `CompileEnv.fileExists` seams), so embedding hookloom in another
 * tool needs no process-global setup.
 */

export { compile, type CompileOptions } from "./compile.js";
export { evaluateWhen, type ConditionVerdict } from "./conditions.js";
export { diffHooks, renderDrift, type DriftLine, type DriftReport } from "./drift.js";
export { ManifestError } from "./errors.js";
export { eventSortKey, isKnownEvent, KNOWN_EVENTS, MATCHERLESS_EVENTS } from "./events.js";
export { lintManifest } from "./lint.js";
export {
  DEFAULT_PRIORITY,
  DEFAULT_TARGET,
  fsIO,
  loadManifest,
  MAX_TIMEOUT_SECONDS,
  parseManifest,
  type ManifestIO,
} from "./manifest.js";
export { adoptSettings, renderAdopted, type AdoptedManifest } from "./adopt.js";
export {
  extractHooks,
  mergeCompiledHooks,
  parseSettings,
  renderSettings,
  type SettingsObject,
} from "./settings.js";
export { referencedVars, substituteVars } from "./vars.js";
export { VERSION } from "./version.js";
export type {
  CompiledCommand,
  CompiledGroup,
  CompiledHooks,
  CompileEnv,
  CompileResult,
  DedupedHook,
  ExcludedHook,
  HookDef,
  IncludedHook,
  LintFinding,
  Manifest,
  WhenClause,
} from "./types.js";
