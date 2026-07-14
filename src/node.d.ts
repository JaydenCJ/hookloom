/**
 * Minimal ambient declarations for the handful of Node.js built-ins this
 * project uses. Declaring them in-repo keeps `typescript` the only
 * devDependency (no `@types/node`); the surface below is intentionally
 * restricted to exactly what `src/` calls, so a typo against a real Node
 * API still fails to compile.
 */

interface ReadableLike {
  setEncoding(encoding: "utf8"): void;
  on(event: "data", cb: (chunk: string) => void): void;
  on(event: "end" | "close", cb: () => void): void;
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options: { recursive: true }): void;
}

declare module "node:path" {
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
  export function isAbsolute(path: string): boolean;
}

declare var process: {
  argv: string[];
  cwd(): string;
  env: Record<string, string | undefined>;
  platform: string;
  exitCode: number | undefined;
  exit(code?: number): never;
  stdin: ReadableLike;
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
};
