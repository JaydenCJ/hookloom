/**
 * Error type for everything the manifest loader and compiler reject.
 * Every error carries the JSON path (or file path) of the offending value,
 * so CLI messages read like `hooks[2].timeout: must be between 1 and 3600 seconds`.
 */

export class ManifestError extends Error {
  /** JSON path (e.g. `hooks[0].when.platform[1]`) or file path. */
  readonly at: string;

  constructor(at: string, message: string) {
    super(`${at}: ${message}`);
    this.name = "ManifestError";
    this.at = at;
  }
}
