/**
 * The hook event vocabulary and its canonical output order.
 *
 * The list mirrors the lifecycle events agent CLIs dispatch from
 * settings.json (`PreToolUse`, `Stop`, ...). Compilation emits events in
 * lifecycle order — not manifest order, not alphabetical — so two people
 * compiling the same manifest always produce byte-identical files.
 */

/** Known events, in the order they are emitted into settings.json. */
export const KNOWN_EVENTS: readonly string[] = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "PreCompact",
  "Stop",
  "SubagentStop",
  "SessionEnd",
];

/** Events where a `matcher` has nothing to match against; a matcher on one
 * of these is almost always a copy-paste mistake, so lint flags it. */
export const MATCHERLESS_EVENTS: readonly string[] = [
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "SessionEnd",
];

export function isKnownEvent(event: string): boolean {
  return KNOWN_EVENTS.includes(event);
}

/** Sort key for emitting events: lifecycle position for known events,
 * then unknown events alphabetically after all known ones. */
export function eventSortKey(event: string): string {
  const i = KNOWN_EVENTS.indexOf(event);
  if (i >= 0) return `0${String(i).padStart(2, "0")}`;
  return `1${event}`;
}
