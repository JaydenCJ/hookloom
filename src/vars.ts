/**
 * `${NAME}` variable substitution for `run` and `matcher` strings.
 *
 * Hook commands live in shell, so the syntax is designed to coexist with
 * it: only the braced form `${NAME}` is a hookloom reference, resolved at
 * compile time from the manifest's `vars` map and `--var` overrides —
 * never from the ambient environment. A bare `$VAR` passes through
 * untouched for the runtime shell, and `$${` escapes a literal `${` for
 * the rare command that needs shell brace expansion. An undefined
 * reference is a hard error, not an empty string: a hook that silently
 * compiles to `"  lint"` is exactly the kind of bug this tool exists to
 * prevent.
 */

import { ManifestError } from "./errors.js";

const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Replace `${NAME}` references in `input` with values from `vars`.
 * `$${` produces a literal `${`; everything else (including bare `$VAR`)
 * is left for the runtime shell. Throws `ManifestError` (tagged with
 * `at`) on undefined variables or malformed references. */
export function substituteVars(
  input: string,
  vars: Record<string, string>,
  at: string
): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch !== "$") {
      out += ch;
      i += 1;
      continue;
    }
    if (input[i + 1] === "$" && input[i + 2] === "{") {
      out += "${";
      i += 3;
      continue;
    }
    if (input[i + 1] !== "{") {
      // Bare `$VAR`, `$$`, trailing `$`: runtime shell territory.
      out += "$";
      i += 1;
      continue;
    }
    const close = input.indexOf("}", i + 2);
    if (close < 0) {
      throw new ManifestError(at, `unterminated "\${" at position ${i}`);
    }
    const name = input.slice(i + 2, close);
    if (!VAR_NAME.test(name)) {
      throw new ManifestError(
        at,
        `invalid variable name "\${${name}}" (use "$\${" for a literal "\${")`
      );
    }
    const value = vars[name];
    if (value === undefined) {
      throw new ManifestError(
        at,
        `undefined variable "\${${name}}" (define it in "vars" or pass --var ${name}=...)`
      );
    }
    out += value;
    i = close + 1;
  }
  return out;
}

/** Collect the variable names referenced by `input`, ignoring `$${`
 * escapes. Malformed references are reported as no names — the
 * substitution pass owns error reporting. Used by lint to find unused
 * `vars`. */
export function referencedVars(input: string): string[] {
  const names: string[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] !== "$") {
      i += 1;
      continue;
    }
    if (input[i + 1] === "$" && input[i + 2] === "{") {
      i += 3;
      continue;
    }
    if (input[i + 1] === "{") {
      const close = input.indexOf("}", i + 2);
      if (close < 0) return names;
      const name = input.slice(i + 2, close);
      if (VAR_NAME.test(name)) names.push(name);
      i = close + 1;
      continue;
    }
    i += 1;
  }
  return names;
}
