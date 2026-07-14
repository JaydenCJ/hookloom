# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- Declarative hook manifest (`hookloom.json`, format version 1): hooks with
  stable ids, events, matchers, commands, timeouts, priorities, tags and
  descriptions, parsed by a strict loader that rejects unknown keys,
  duplicate ids, out-of-range values and malformed clauses with the JSON
  path of every error.
- Compiler with three guarantees: deterministic byte-identical output,
  lifecycle event ordering with priority sort and manifest-position
  tie-breaking, and dedupe of identical compiled commands within a matcher
  group (drops reported with the surviving id).
- Compile-time `when` conditions — `platform`, `env`, `envEquals`,
  `fileExists`, `profile`, and recursive `not` — evaluated against an
  injectable environment, with a per-fact trace used in exclusion reasons.
- `${VAR}` substitution resolved only from manifest `vars` and `--var`
  overrides (never the ambient environment); bare `$VAR` passes through to
  the runtime shell and `$${` escapes a literal `${`; undefined references
  are hard errors.
- `extends` chains: parent-first merge with id-level in-place override
  (including `"enabled": false` opt-outs), per-name var override, nearest
  `target`, relative resolution per file, and cycle detection.
- Target settings handling that owns exactly the `hooks` key: every other
  key is preserved in value and order, rebuilds are idempotent, and an
  unchanged compile writes nothing.
- Structural drift check (`hookloom check`): in-memory recompile diffed
  against the committed file with `+`/`-`/`~` lines per event and matcher
  group, order-sensitive because hook order is execution order; exit 1 on
  any drift, including hand edits behind the manifest's back.
- `hookloom explain`: every declared hook with its fate — included (final
  execution order), excluded (the exact failing condition), or
  deduplicated.
- `hookloom lint`: unknown events, matchers on matcherless events, matcher
  regex validation, undefined and unused variables, duplicate commands and
  unreachable profile hooks; errors exit 1, warnings pass.
- `hookloom adopt`: reverse-compiles an existing settings.json into a
  manifest with readable ids and spaced priorities that round-trips to a
  green `check`.
- `hookloom` CLI (`build` / `check` / `explain` / `lint` / `adopt`) with
  `--profile`, `--var`, `--platform`, `--stdout`, `--target`, `--settings`,
  `--out` and the stable exit-code contract 0 success / 1 findings /
  2 usage or input errors.
- Public programmatic API (`loadManifest`, `parseManifest`, `compile`,
  `evaluateWhen`, `diffHooks`, `lintManifest`, `adoptSettings`, …) with
  type declarations and injectable filesystem seams.
- Bundled examples: a team base manifest, a project manifest extending it,
  and a legacy settings file for the adopt flow.
- Test suite: 91 node:test tests (loader, vars, conditions, compiler,
  settings handling, drift, lint, adopt, argv parsing, full CLI runs) and
  an end-to-end `scripts/smoke.sh` against the bundled examples.

[0.1.0]: https://github.com/JaydenCJ/hookloom/releases/tag/v0.1.0
