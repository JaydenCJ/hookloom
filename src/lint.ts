/**
 * Manifest lint: catches the mistakes the parser deliberately tolerates.
 *
 * The parser rejects structural nonsense; lint flags things that are
 * *valid* but almost certainly wrong — an event name with a typo, a matcher
 * on an event that never matches tools, a regex that will not compile, two
 * hooks that will silently collapse into one. Errors fail `hookloom lint`
 * (exit 1); warnings print but pass, so teams can adopt lint in CI without
 * an archaeology project first.
 */

import { isKnownEvent, KNOWN_EVENTS, MATCHERLESS_EVENTS } from "./events.js";
import { referencedVars } from "./vars.js";
import type { LintFinding, Manifest } from "./types.js";

export function lintManifest(manifest: Manifest): LintFinding[] {
  const findings: LintFinding[] = [];

  const definedVars = new Set(Object.keys(manifest.vars));
  const usedVars = new Set<string>();

  for (const hook of manifest.hooks) {
    const where = `hook "${hook.id}"`;

    // Unknown events are errors: a typo'd event is a hook that never fires,
    // which is the least discoverable failure mode this tool can have.
    if (!isKnownEvent(hook.event)) {
      findings.push({
        severity: "error",
        rule: "unknown-event",
        message: `${where}: unknown event "${hook.event}" (known: ${KNOWN_EVENTS.join(", ")})`,
      });
    }

    if (hook.matcher !== "" && MATCHERLESS_EVENTS.includes(hook.event)) {
      findings.push({
        severity: "warning",
        rule: "matcher-ignored",
        message: `${where}: event "${hook.event}" does not use matchers; "${hook.matcher}" will be ignored by the runtime`,
      });
    }

    // Matchers are regular expressions at runtime; one that does not
    // compile matches nothing, silently.
    if (hook.matcher !== "" && !hook.matcher.includes("${")) {
      try {
        new RegExp(hook.matcher);
      } catch {
        findings.push({
          severity: "error",
          rule: "invalid-matcher",
          message: `${where}: matcher "${hook.matcher}" is not a valid regular expression`,
        });
      }
    }

    for (const name of [...referencedVars(hook.run), ...referencedVars(hook.matcher)]) {
      usedVars.add(name);
      if (!definedVars.has(name)) {
        findings.push({
          severity: "error",
          rule: "undefined-var",
          message: `${where}: references undefined variable "\${${name}}"`,
        });
      }
    }

    if (hook.when?.profile !== undefined && hook.enabled === false) {
      findings.push({
        severity: "warning",
        rule: "disabled-profile-hook",
        message: `${where}: has "when.profile" but is disabled; no profile can ever enable it`,
      });
    }
  }

  // Exact duplicates collapse at compile time; declaring them is usually a
  // merge artifact worth cleaning up.
  const seen = new Map<string, string>();
  for (const hook of manifest.hooks) {
    if (!hook.enabled) continue;
    const key = JSON.stringify([hook.event, hook.matcher, hook.run, hook.timeout ?? null]);
    const firstId = seen.get(key);
    if (firstId !== undefined) {
      findings.push({
        severity: "warning",
        rule: "duplicate-command",
        message: `hook "${hook.id}" duplicates "${firstId}" (same event, matcher, run and timeout); the compiler will emit it once`,
      });
    } else {
      seen.set(key, hook.id);
    }
  }

  for (const name of definedVars) {
    if (!usedVars.has(name)) {
      findings.push({
        severity: "warning",
        rule: "unused-var",
        message: `vars.${name} is defined but never referenced`,
      });
    }
  }

  return findings;
}
