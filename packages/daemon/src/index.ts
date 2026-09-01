export * from './config.js';
export * from './storage/db.js';
export * from './storage/screenshot-store.js';
export * from './session/manager.js';
export * from './incidents/engine.js';
export * from './notes/engine.js';
export * from './notes/verification.js';
export * from './verification/engine.js';
export * from './server/http.js';
export * from './server/ws.js';
export * from './server/daemon.js';

import { BrowserTrackDaemon } from './server/daemon.js';
import type { DaemonConfig } from './config.js';

export function createDaemon(config: Partial<DaemonConfig> = {}): BrowserTrackDaemon {
  return new BrowserTrackDaemon(config);
}
