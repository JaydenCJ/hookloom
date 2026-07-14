# Contributing to hookloom

Issues, discussions and pull requests are all welcome — this project aims to
stay small, zero-dependency at runtime, and boringly deterministic.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/hookloom.git
cd hookloom
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 91 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (build, the drift loop, profiles,
explain, lint, adopt round-trip, determinism) against the bundled example
manifests and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable modules
   (the compiler and the diff take data plus injected seams, not file
   handles or process globals).
5. Changes to compilation or comparison semantics need a row in
   `docs/manifest-format.md`, the README tables, and a test pinning the
   exact output.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature; adding one needs justification in the PR and will usually be
  declined.
- **Deterministic output is the product.** The same manifest, flags and
  environment must always compile to a byte-identical file. Anything that
  reads the clock, randomness, or unlisted ambient state in the compile
  path will be rejected.
- **hookloom owns only the `hooks` key.** Every other byte of the target
  settings file must survive a rebuild untouched, in value and in order.
- **Fail loudly.** Unknown manifest keys, undefined `${VAR}` references and
  malformed settings files are hard errors with JSON paths — never
  best-effort guesses.
- Exit codes (0 success / 1 drift or lint errors / 2 usage or input errors)
  are stable API; do not repurpose them.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `hookloom --version` output, the manifest (or a minimal
one), the target settings file, the exact command with flags, and what you
expected the compiled output or diff to be. `hookloom explain` output is
usually the fastest way to show what the compiler decided.

## Security

hookloom writes files that configure what commands an agent runs, so
manifest-injection or output-corruption issues are vulnerabilities: do not
open public issues for them. Use GitHub private vulnerability reporting on
this repository instead.
