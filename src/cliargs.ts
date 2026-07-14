/**
 * Tiny, dependency-free argv parser for the hookloom CLI.
 *
 * Supports exactly what the CLI needs: `--flag value`, `--flag=value`,
 * repeatable flags, and booleans. Unknown flags are usage errors (exit 2),
 * never silently ignored — a mistyped `--proflie ci` that quietly compiles
 * the wrong hook set would defeat the whole tool.
 */

export interface FlagSpec {
  /** `boolean` takes no value; `string` takes one; `repeat` accumulates. */
  kind: "boolean" | "string" | "repeat";
}

export interface ParsedArgs {
  command: string | null;
  flags: Record<string, string | boolean | string[]>;
  positionals: string[];
  error?: string;
}

export function parseArgs(argv: string[], specs: Record<string, FlagSpec>): ParsedArgs {
  const parsed: ParsedArgs = { command: null, flags: {}, positionals: [] };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      if (parsed.command === null) parsed.command = arg;
      else parsed.positionals.push(arg);
      i += 1;
      continue;
    }

    let name = arg.slice(2);
    let inlineValue: string | undefined;
    const eq = name.indexOf("=");
    if (eq >= 0) {
      inlineValue = name.slice(eq + 1);
      name = name.slice(0, eq);
    }

    const spec = specs[name];
    if (spec === undefined) {
      parsed.error = `unknown flag --${name}`;
      return parsed;
    }

    if (spec.kind === "boolean") {
      if (inlineValue !== undefined) {
        parsed.error = `--${name} does not take a value`;
        return parsed;
      }
      parsed.flags[name] = true;
      i += 1;
      continue;
    }

    let value = inlineValue;
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        parsed.error = `--${name} requires a value`;
        return parsed;
      }
      i += 1;
    }

    if (spec.kind === "repeat") {
      const existing = parsed.flags[name];
      if (Array.isArray(existing)) existing.push(value);
      else parsed.flags[name] = [value];
    } else {
      if (parsed.flags[name] !== undefined) {
        parsed.error = `--${name} was given more than once`;
        return parsed;
      }
      parsed.flags[name] = value;
    }
    i += 1;
  }

  return parsed;
}

/** Parse repeatable `--var NAME=value` flags into a map. */
export function parseVarFlags(values: string[]): { vars: Record<string, string>; error?: string } {
  const vars: Record<string, string> = {};
  for (const value of values) {
    const eq = value.indexOf("=");
    if (eq <= 0) {
      return { vars, error: `--var expects NAME=value, got "${value}"` };
    }
    const name = value.slice(0, eq);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return { vars, error: `--var: "${name}" is not a valid variable name` };
    }
    vars[name] = value.slice(eq + 1);
  }
  return { vars };
}
