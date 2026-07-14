/**
 * Compile-time evaluation of `when` clauses.
 *
 * Conditions are decided once, at compile time, against an explicit
 * `CompileEnv` — never at hook runtime and never against hidden global
 * state. Every verdict carries a human-readable trace so `hookloom explain`
 * can answer "why is this hook missing from my settings.json?" in one line.
 */

import type { CompileEnv, WhenClause } from "./types.js";

export interface ConditionVerdict {
  ok: boolean;
  /** One line per checked condition, e.g. `env "CI" is not set`. */
  trace: string[];
}

/** Evaluate a clause: every present key must hold (AND semantics);
 * `not` holds when its nested clause does not. */
export function evaluateWhen(when: WhenClause | undefined, env: CompileEnv): ConditionVerdict {
  if (when === undefined) return { ok: true, trace: [] };

  const trace: string[] = [];
  let ok = true;

  if (when.platform !== undefined) {
    const hit = when.platform.includes(env.platform);
    trace.push(
      hit
        ? `platform "${env.platform}" is in [${when.platform.join(", ")}]`
        : `platform "${env.platform}" is not in [${when.platform.join(", ")}]`
    );
    ok = ok && hit;
  }

  if (when.env !== undefined) {
    for (const name of when.env) {
      const value = env.env[name];
      const hit = value !== undefined && value !== "";
      trace.push(hit ? `env "${name}" is set` : `env "${name}" is not set`);
      ok = ok && hit;
    }
  }

  if (when.envEquals !== undefined) {
    for (const [name, expected] of Object.entries(when.envEquals)) {
      const actual = env.env[name];
      const hit = actual === expected;
      trace.push(
        hit
          ? `env "${name}" equals "${expected}"`
          : `env "${name}" is ${actual === undefined ? "not set" : `"${actual}"`}, expected "${expected}"`
      );
      ok = ok && hit;
    }
  }

  if (when.fileExists !== undefined) {
    for (const path of when.fileExists) {
      const hit = env.fileExists(path);
      trace.push(hit ? `file "${path}" exists` : `file "${path}" does not exist`);
      ok = ok && hit;
    }
  }

  if (when.profile !== undefined) {
    const hit = when.profile.some((p) => env.profiles.includes(p));
    const selected = env.profiles.length > 0 ? `[${env.profiles.join(", ")}]` : "none";
    trace.push(
      hit
        ? `profile matches (selected: ${selected})`
        : `profile requires one of [${when.profile.join(", ")}] (selected: ${selected})`
    );
    ok = ok && hit;
  }

  if (when.not !== undefined) {
    const inner = evaluateWhen(when.not, env);
    trace.push(...inner.trace.map((line) => `not(${line})`));
    ok = ok && !inner.ok;
  }

  return { ok, trace };
}
