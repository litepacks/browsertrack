import os from 'node:os';
import path from 'node:path';

export interface DaemonConfig {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  screenshotsDir: string;
  maxEventsPerSession: number;
  verbose: boolean;
}

export function getDaemonConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  const homeDir = os.homedir();
  const dataDir = overrides.dataDir || path.join(homeDir, '.browsertrack');
  const dbPath = overrides.dbPath || path.join(dataDir, 'browsertrack.db');
  const screenshotsDir = overrides.screenshotsDir || path.join(dataDir, 'projects');

  return {
    host: overrides.host || '127.0.0.1',
    port: overrides.port || 7331,
    dataDir,
    dbPath,
    screenshotsDir,
    maxEventsPerSession: overrides.maxEventsPerSession || 1000,
    verbose: !!overrides.verbose,
  };
}
