# hookloom examples

Three files that demonstrate the intended team workflow.

## `team.loom.json`

The shared base manifest a platform team publishes: two `PreToolUse` guards,
a formatter on `PostToolUse`, a local-only session journal (gated with
`when.not.env: CI`), and a transcript exporter that only compiles under
`--profile ci`.

## `project.loom.json`

A project manifest that `extends` the team base. It overrides the `FORMAT`
variable, disables the inherited `log-session` hook by redeclaring its id
with `"enabled": false`, and adds its own `typecheck-on-edit` hook gated on
`when.fileExists: tsconfig.json`.

Try it from this directory:

```bash
node ../dist/cli.js explain --manifest project.loom.json --profile ci
node ../dist/cli.js build   --manifest project.loom.json --stdout
```

`explain` shows every declared hook with its fate: included (with the final
execution order), excluded (with the exact failing condition), or
deduplicated.

## `legacy-settings.json`

A hand-written settings file of the kind most repositories already have —
hooks mixed in with permissions and env. Turn it into a manifest:

```bash
node ../dist/cli.js adopt --settings legacy-settings.json --target legacy-settings.json
```

The generated manifest compiles back to exactly the hooks the file already
contains, so `hookloom check` is green from the first commit.
