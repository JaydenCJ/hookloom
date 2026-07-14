# The hookloom manifest format

A hookloom manifest is a single JSON file (conventionally `hookloom.json`)
that declares every hook a repository wants in its agent settings file.
`hookloom build` compiles it; `hookloom check` verifies the compiled output
is what is committed. This document is the full reference for version 1 of
the format.

The loader is strict: unknown keys anywhere, duplicate ids, out-of-range
timeouts and malformed `when` clauses are all hard errors reported with
their JSON path (`hooks[2].timeout: must be between 1 and 3600 seconds`).
A typo that silently drops a hook is the failure mode hookloom exists to
prevent, so nothing is ignored.

## Top level

| Key | Required | Default | Meaning |
|---|---|---|---|
| `version` | yes | — | must be `1` |
| `extends` | no | `[]` | path(s) to parent manifests, relative to this file |
| `target` | no | `.claude/settings.json` | settings file to write, relative to this file |
| `vars` | no | `{}` | variables usable as `${NAME}` in `run` and `matcher` |
| `hooks` | yes | — | array of hook declarations |

## Hook declarations

```json
{
  "id": "format-on-edit",
  "event": "PostToolUse",
  "matcher": "Write|Edit",
  "run": "${FORMAT} \"$CLAUDE_FILE_PATHS\"",
  "timeout": 60,
  "priority": 20,
  "enabled": true,
  "when": { "fileExists": "package.json" },
  "tags": ["format"],
  "description": "Keep edited files formatted so diffs stay reviewable."
}
```

| Key | Required | Default | Meaning |
|---|---|---|---|
| `id` | yes | — | unique, stable name; the unit of override in `extends` |
| `event` | yes | — | lifecycle event (see the event list in the README) |
| `matcher` | no | `""` | tool-name regex for tool events; omitted from output when empty |
| `run` | yes | — | the shell command; `${NAME}` resolved at compile time |
| `timeout` | no | none | seconds, 1–3600, emitted verbatim |
| `priority` | no | `100` | 0–9999; lower runs earlier within the event |
| `enabled` | no | `true` | `false` parses and lints but never compiles |
| `when` | no | none | compile-time condition (below) |
| `tags` | no | `[]` | free-form labels for your own tooling; not emitted |
| `description` | no | none | human note; not emitted |

### Ordering semantics

Order in the compiled file is fully determined: events emit in lifecycle
order; within an event, matcher groups sort by their most urgent member's
priority (ties broken by matcher text); within a group, hooks sort by
priority with manifest position as the stable tie-breaker. Manifest array
order never leaks into the output except as that final tie-breaker, so
reordering declarations without changing priorities is a no-op.

### Variables

Only the braced form `${NAME}` is a hookloom reference, resolved at compile
time from `vars` plus `--var NAME=value` overrides (CLI wins). Bare `$VAR`
passes through untouched for the runtime shell, and `$${` escapes a literal
`${`. Referencing an undefined variable is a compile error, never an empty
string. Values come only from the manifest and the command line — never
from the ambient environment — so compiled output is reproducible.

## `when` conditions

All present keys must hold (AND). Every key accepting a string also accepts
an array.

| Key | Holds when |
|---|---|
| `platform` | the compile platform is one of `linux` / `darwin` / `win32` |
| `env` | every named environment variable is set and non-empty |
| `envEquals` | each variable equals the given value exactly |
| `fileExists` | every path (relative to the manifest) exists |
| `profile` | any listed profile was selected via `--profile` |
| `not` | the nested clause does NOT hold |

Conditions are evaluated once, at compile time, against the machine (or the
`--platform` override) doing the compiling. A hook excluded by `when` is
reported by `hookloom explain` together with the exact failing fact.

## `extends`

Parents are loaded first, in order; the child is applied last. Hooks merge
by `id`: a child declaration replaces the parent's *in place* (keeping the
parent's slot in the ordering tie-breaker), and new ids append after. This
means a project can re-pin, retune or disable (`"enabled": false`) a single
team hook without reshuffling everything else. `vars` merge with the child
winning per name; `target` is the nearest one declared. Chains may nest;
cycles are detected and rejected.

## Compiled output

hookloom owns exactly one key of the target file: `hooks`. All other keys
(permissions, env, model, anything future tools add) are preserved in value
and in order, and a rebuild that changes nothing rewrites nothing. Exact
duplicates after substitution — same event, matcher, command and timeout —
collapse to a single entry, and the drop is reported.
