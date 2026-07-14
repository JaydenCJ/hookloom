/**
 * The compiler: manifest -> settings.json `hooks` value.
 *
 * Guarantees, in order of importance:
 *  1. Deterministic — the same manifest, environment and profiles always
 *     produce byte-identical output, regardless of who runs the compile.
 *  2. Ordered — events emit in lifecycle order; inside an event, matcher
 *     groups and commands sort by priority, with manifest position as the
 *     stable tie-breaker. "It works on my machine because my hooks array
 *     happened to be in a different order" cannot happen.
 *  3. Deduplicated — two declarations that compile to the same command in
 *     the same event/matcher group collapse to one entry, so a hook merged
 *     twice from two branches does not fire twice.
 */

import { evaluateWhen } from "./conditions.js";
import { eventSortKey } from "./events.js";
import { substituteVars } from "./vars.js";
import type {
  CompileEnv,
  CompileResult,
  CompiledCommand,
  CompiledGroup,
  CompiledHooks,
  DedupedHook,
  ExcludedHook,
  HookDef,
  IncludedHook,
  Manifest,
} from "./types.js";

export interface CompileOptions {
  /** Extra variables layered over the manifest's `vars` (CLI `--var`). */
  vars?: Record<string, string>;
}

interface Candidate {
  hook: HookDef;
  command: string;
  matcher: string;
}

/** Compile a manifest against an explicit environment. Pure: no filesystem
 * reads beyond the injected `env.fileExists`, no clock, no randomness. */
export function compile(manifest: Manifest, env: CompileEnv, options: CompileOptions = {}): CompileResult {
  const vars = { ...manifest.vars, ...(options.vars ?? {}) };

  const included: IncludedHook[] = [];
  const excluded: ExcludedHook[] = [];
  const deduped: DedupedHook[] = [];
  const candidates: Candidate[] = [];

  for (const hook of manifest.hooks) {
    if (!hook.enabled) {
      excluded.push({ id: hook.id, reason: "disabled (enabled: false)" });
      continue;
    }
    const verdict = evaluateWhen(hook.when, env);
    if (!verdict.ok) {
      const failing = verdict.trace.filter((line) => !isPassingTraceLine(line));
      excluded.push({
        id: hook.id,
        reason: `when: ${failing.length > 0 ? failing.join("; ") : verdict.trace.join("; ")}`,
      });
      continue;
    }
    const at = `hooks(id=${hook.id})`;
    candidates.push({
      hook,
      command: substituteVars(hook.run, vars, `${at}.run`),
      matcher: substituteVars(hook.matcher, vars, `${at}.matcher`),
    });
  }

  // Group by event, then by (post-substitution) matcher.
  const byEvent = new Map<string, Map<string, Candidate[]>>();
  for (const candidate of candidates) {
    const groups = byEvent.get(candidate.hook.event) ?? new Map<string, Candidate[]>();
    byEvent.set(candidate.hook.event, groups);
    const group = groups.get(candidate.matcher) ?? [];
    groups.set(candidate.matcher, group);
    group.push(candidate);
  }

  const hooks: CompiledHooks = {};
  const events = [...byEvent.keys()].sort((a, b) => cmp(eventSortKey(a), eventSortKey(b)));

  for (const event of events) {
    const groups = byEvent.get(event)!;
    const orderedGroups = [...groups.entries()]
      .map(([matcher, members]) => ({
        matcher,
        members: sortMembers(members),
        rank: Math.min(...members.map((m) => m.hook.priority)),
      }))
      .sort((a, b) => a.rank - b.rank || cmp(a.matcher, b.matcher));

    const compiledGroups: CompiledGroup[] = [];
    for (const group of orderedGroups) {
      const commands: CompiledCommand[] = [];
      const seen = new Map<string, string>(); // dedupe key -> surviving hook id
      for (const member of group.members) {
        const key = JSON.stringify([member.command, member.hook.timeout ?? null]);
        const keptId = seen.get(key);
        if (keptId !== undefined) {
          deduped.push({ id: member.hook.id, keptId, event, matcher: group.matcher });
          continue;
        }
        seen.set(key, member.hook.id);
        const entry: CompiledCommand = { type: "command", command: member.command };
        if (member.hook.timeout !== undefined) entry.timeout = member.hook.timeout;
        commands.push(entry);
        included.push({
          id: member.hook.id,
          event,
          matcher: group.matcher,
          priority: member.hook.priority,
          command: member.command,
          timeout: member.hook.timeout,
        });
      }
      if (commands.length === 0) continue;
      compiledGroups.push(
        group.matcher !== "" ? { matcher: group.matcher, hooks: commands } : { hooks: commands }
      );
    }
    if (compiledGroups.length > 0) hooks[event] = compiledGroups;
  }

  return { hooks, included, excluded, deduped };
}

function sortMembers(members: Candidate[]): Candidate[] {
  return [...members].sort(
    (a, b) => a.hook.priority - b.hook.priority || a.hook.index - b.hook.index
  );
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A trace line is "passing" when the fact it records holds; used to shrink
 * exclusion reasons down to the conditions that actually failed. A `not(…)`
 * line holds exactly when the wrapped fact does not, so negation recurses. */
function isPassingTraceLine(line: string): boolean {
  if (line.startsWith("not(") && line.endsWith(")")) {
    return !isPassingTraceLine(line.slice(4, -1));
  }
  return (
    / is set$/.test(line) ||
    / exists$/.test(line) ||
    /^platform .* is in /.test(line) ||
    / equals /.test(line) ||
    /^profile matches /.test(line)
  );
}
