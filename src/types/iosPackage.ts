export interface IosPackageCheckResult {
  /** App name derived from the Payload/<App>.app/ entry, or null if none was found */
  appName: string | null;
  hasDsym: boolean;
  notes: string[];
}
