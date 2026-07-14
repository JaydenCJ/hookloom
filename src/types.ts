/**
 * Shared types for the hookloom pipeline:
 * manifest (declarative source) -> compile (order, filter, dedupe)
 * -> settings.json `hooks` value (generated target).
 */

/** A compile-time condition attached to a hook via `when`. Every present
 * key must hold for the hook to be included; `not` negates a nested clause. */
export interface WhenClause {
  /** Include only on these platforms (`linux`, `darwin`, `win32`). */
  platform?: string[];
  /** Include only when every named environment variable is set and non-empty. */
  env?: string[];
  /** Include only when each variable equals the given value exactly. */
  envEquals?: Record<string, string>;
  /** Include only when every path (relative to the manifest) exists. */
  fileExists?: string[];
  /** Include only when one of these profiles was selected via `--profile`. */
  profile?: string[];
  /** Negation: include only when the nested clause does NOT hold. */
  not?: WhenClause;
}

/** One hook declaration after parsing (defaults applied, extends resolved). */
export interface HookDef {
  /** Unique, stable identifier; the unit of override in `extends`. */
  id: string;
  /** Lifecycle event name, e.g. `PreToolUse`. */
  event: string;
  /** Tool-name pattern for the event, "" when not applicable. */
  matcher: string;
  /** Shell command to run; `${VAR}` references resolved at compile time. */
  run: string;
  /** Optional per-hook timeout in seconds (emitted verbatim). */
  timeout?: number;
  /** Sort key within an event; lower runs earlier. Default 100. */
  priority: number;
  /** Disabled hooks parse and lint but never compile. Default true. */
  enabled: boolean;
  /** Optional compile-time condition. */
  when?: WhenClause;
  /** Free-form labels; kept for tooling, not emitted. */
  tags: string[];
  /** Human note; kept in the manifest, not emitted. */
  description?: string;
  /** Absolute path of the manifest file that declared this hook. */
  origin: string;
  /** Stable position after extends-merge; the final ordering tie-breaker. */
  index: number;
}

/** A parsed manifest with `extends` chains flattened and defaults applied. */
export interface Manifest {
  version: 1;
  /** Target settings file, relative to the manifest directory by default. */
  target: string;
  /** Variables available as `${NAME}` in `run` and `matcher`. */
  vars: Record<string, string>;
  hooks: HookDef[];
  /** Absolute path of the root manifest file ("<inline>" when parsed from a string). */
  path: string;
}

/** One command entry as it appears in settings.json. */
export interface CompiledCommand {
  type: "command";
  command: string;
  timeout?: number;
}

/** One matcher group as it appears in settings.json. */
export interface CompiledGroup {
  matcher?: string;
  hooks: CompiledCommand[];
}

/** The full generated value of the settings.json `hooks` key. */
export type CompiledHooks = Record<string, CompiledGroup[]>;

/** Where a compiled command came from, for `explain` and drift messages. */
export interface IncludedHook {
  id: string;
  event: string;
  matcher: string;
  priority: number;
  command: string;
  timeout?: number;
}

/** A hook left out of the compilation, and the human-readable reason. */
export interface ExcludedHook {
  id: string;
  reason: string;
}

/** A duplicate command collapsed by dedupe; `keptId` is the survivor. */
export interface DedupedHook {
  id: string;
  keptId: string;
  event: string;
  matcher: string;
}

/** Everything `compile()` decided, with full provenance. */
export interface CompileResult {
  hooks: CompiledHooks;
  included: IncludedHook[];
  excluded: ExcludedHook[];
  deduped: DedupedHook[];
}

/** The facts conditions are evaluated against. Injected so compilation is a
 * pure function of its inputs — tests and `--platform` overrides both use it. */
export interface CompileEnv {
  platform: string;
  env: Record<string, string | undefined>;
  /** Existence probe for `when.fileExists`, rooted at the manifest directory. */
  fileExists: (path: string) => boolean;
  /** Profiles selected via `--profile`, in order. */
  profiles: string[];
}

/** A single lint finding; `error` findings fail `hookloom lint`. */
export interface LintFinding {
  severity: "error" | "warning";
  rule: string;
  message: string;
}
