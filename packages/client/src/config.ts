export interface BrowserDiagClientOptions {
  daemonUrl?: string;
  projectId?: string;
  maxBreadcrumbs?: number;
  captureErrors?: boolean;
  captureConsole?: boolean;
  captureNetwork?: boolean;
  captureNavigation?: boolean;
  captureInteractions?: boolean;
  onErrorScreenshot?: boolean;
  notes?: {
    enabled?: boolean;
    shortcut?: string;
    showBadges?: boolean;
    maskSelectors?: string[];
  };
  debug?: boolean;
}

export const DEFAULT_OPTIONS: Required<Omit<BrowserDiagClientOptions, 'notes'>> & { notes: Required<NonNullable<BrowserDiagClientOptions['notes']>> } = {
  daemonUrl: 'ws://127.0.0.1:7331',
  projectId: '',
  maxBreadcrumbs: 50,
  captureErrors: true,
  captureConsole: true,
  captureNetwork: true,
  captureNavigation: true,
  captureInteractions: true,
  onErrorScreenshot: true,
  notes: {
    enabled: true,
    shortcut: 'Alt+Click',
    showBadges: true,
    maskSelectors: ['input[type="password"]', '[data-sensitive]'],
  },
  debug: false,
};
