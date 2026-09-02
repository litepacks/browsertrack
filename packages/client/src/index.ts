import { BrowserTrackClient } from './client.js';
import type { BrowserDiagClientOptions } from './config.js';

export * from './client.js';
export * from './config.js';
export * from './breadcrumbs.js';
export * from './screenshot/driver.js';
export * from './screenshot/browser-script-driver.js';
export * from './notes/inspector.js';
export * from './source/resolver.js';

let defaultClient: BrowserTrackClient | null = null;

/**
 * Initializes the BrowserTrack client.
 */
export function init(options: BrowserDiagClientOptions = {}): BrowserTrackClient {
  if (defaultClient) {
    return defaultClient;
  }

  defaultClient = new BrowserTrackClient(options);
  defaultClient.init();
  return defaultClient;
}

export function getClient(): BrowserTrackClient | null {
  return defaultClient;
}

// Auto-initialize when injected via <script src="...">
if (typeof window !== 'undefined') {
  (window as any).__BROWSERTRACK__ = {
    init,
    getClient,
  };

  // Auto-start by default in browser if not explicitly disabled
  try {
    const currentScript = document.currentScript;
    const autoInit = currentScript?.getAttribute('data-auto-init') !== 'false';
    const daemonUrl = currentScript?.getAttribute('data-daemon-url') || undefined;
    const projectId = currentScript?.getAttribute('data-project-id') || undefined;
    const hidden = currentScript?.getAttribute('data-hidden') === 'true';
    const hideQueryParam = currentScript?.getAttribute('data-hide-query-param') || undefined;

    if (autoInit) {
      init({ daemonUrl, projectId, hidden, hideQueryParam });
    }
  } catch {
    // If auto-start fails, don't crash
  }
}
