/**
 * Drift detection: is the committed settings.json exactly what the manifest
 * compiles to?
 *
 * This is the CI half of hookloom. `hookloom check` compiles in memory,
 * compares against the file on disk, and exits 1 with a readable diff when
 * they disagree — whether the manifest moved ahead of the file, or someone
 * hand-edited the file behind the manifest's back. The comparison is
 * structural (parsed JSON, normalized matcher groups), so formatting-only
 * differences are not drift; order differences are, because hook order is
 * execution order.
 */

import { eventSortKey } from "./events.js";
import type { CompiledCommand, CompiledGroup, CompiledHooks } from "./types.js";

export interface DriftLine {
  /** `+` only in the compiled manifest, `-` only in the file, `~` order. */
  kind: "+" | "-" | "~";
  event: string;
  matcher: string;
  detail: string;
}

export interface DriftReport {
  clean: boolean;
  lines: DriftLine[];
}

function commandKey(entry: CompiledCommand): string {
  return entry.timeout !== undefined
    ? `${entry.command}\u0001${entry.timeout}`
    : entry.command;
}

function describe(entry: CompiledCommand): string {
  return entry.timeout !== undefined
    ? `"${entry.command}" (timeout ${entry.timeout}s)`
    : `"${entry.command}"`;
}

function groupsByMatcher(groups: CompiledGroup[]): Map<string, CompiledCommand[]> {
  const out = new Map<string, CompiledCommand[]>();
  for (const group of groups) {
    const matcher = group.matcher ?? "";
    const existing = out.get(matcher) ?? [];
    out.set(matcher, [...existing, ...group.hooks]);
  }
  return out;
}

/** Compare the compiled hooks (`expected`) against what a settings file
 * currently contains (`actual`). */
export function diffHooks(expected: CompiledHooks, actual: CompiledHooks): DriftReport {
  const lines: DriftLine[] = [];

  const events = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort((a, b) =>
    eventSortKey(a) < eventSortKey(b) ? -1 : eventSortKey(a) > eventSortKey(b) ? 1 : 0
  );

  for (const event of events) {
    const expectedGroups = groupsByMatcher(expected[event] ?? []);
    const actualGroups = groupsByMatcher(actual[event] ?? []);
    const matchers = [...new Set([...expectedGroups.keys(), ...actualGroups.keys()])].sort();

    for (const matcher of matchers) {
      const want = expectedGroups.get(matcher) ?? [];
      const have = actualGroups.get(matcher) ?? [];
      const wantKeys = want.map(commandKey);
      const haveKeys = have.map(commandKey);

      for (const entry of want) {
        if (!haveKeys.includes(commandKey(entry))) {
          lines.push({ kind: "+", event, matcher, detail: describe(entry) });
        }
      }
      for (const entry of have) {
        if (!wantKeys.includes(commandKey(entry))) {
          lines.push({ kind: "-", event, matcher, detail: describe(entry) });
        }
      }
      // Same command set but a different sequence is still drift: hook
      // order is execution order. \u0001 join keeps keys collision-free.
      const sharedWant = wantKeys.filter((k) => haveKeys.includes(k));
      const sharedHave = haveKeys.filter((k) => wantKeys.includes(k));
      if (sharedWant.join("\u0001") !== sharedHave.join("\u0001")) {
        lines.push({
          kind: "~",
          event,
          matcher,
          detail: `order differs (manifest: ${summarize(want)}; file: ${summarize(have)})`,
        });
      }
    }
  }

  return { clean: lines.length === 0, lines };
}

function summarize(entries: CompiledCommand[]): string {
  return entries.map((e) => firstWord(e.command)).join(" -> ");
}

function firstWord(command: string): string {
  const word = command.trim().split(/\s+/)[0] ?? "";
  return word.length > 24 ? `${word.slice(0, 21)}...` : word;
}

/** Render a report as the indented block `hookloom check` prints. */
export function renderDrift(report: DriftReport): string[] {
  const out: string[] = [];
  let lastHeader = "";
  for (const line of report.lines) {
    const header = line.matcher === "" ? line.event : `${line.event} / "${line.matcher}"`;
    if (header !== lastHeader) {
      out.push(`  ${header}:`);
      lastHeader = header;
    }
    out.push(`    ${line.kind} ${line.detail}`);
  }
  return out;
}
