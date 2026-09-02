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
    showToolbar?: boolean;
    maskSelectors?: string[];
  };
  /**
   * Hide visible BrowserTrack UI (toolbar dock, pins, hover overlay) by default.
   */
  hidden?: boolean;
  /**
   * Custom query parameter(s) used to hide the UI (e.g. 'e2e', 'no_ui', 'clean').
   * Built-in query params like ?bt=0, ?bt=false, ?bt=hidden, ?browsertrack=false, ?no_bt are supported automatically.
   */
  hideQueryParam?: string | string[];
  debug?: boolean;
}

export const DEFAULT_OPTIONS: Required<Omit<BrowserDiagClientOptions, 'notes' | 'hideQueryParam'>> & {
  hideQueryParam?: string | string[];
  notes: Required<NonNullable<BrowserDiagClientOptions['notes']>>;
} = {
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
    showToolbar: true,
    maskSelectors: ['input[type="password"]', '[data-sensitive]'],
  },
  hidden: false,
  hideQueryParam: undefined,
  debug: false,
};

const HIDE_VALUES = new Set(['0', 'false', 'hidden', 'hide', 'off', 'none', 'disabled', 'ui_off', 'silent']);

/**
 * Checks if the tool's visible UI should be hidden based on URL search query parameters.
 */
export function shouldHideUIFromUrl(customParam?: string | string[], searchString?: string): boolean {
  let search = searchString;
  if (search === undefined) {
    if (typeof window === 'undefined' || !window.location) return false;
    search = window.location.search;
  }

  if (!search) return false;

  try {
    const params = new URLSearchParams(search);

    // 1. Check custom parameters if configured
    if (customParam) {
      const customKeys = Array.isArray(customParam) ? customParam : [customParam];
      for (const key of customKeys) {
        if (params.has(key)) {
          const val = (params.get(key) || '').toLowerCase().trim();
          if (val === '' || val === '1' || val === 'true' || HIDE_VALUES.has(val)) {
            return true;
          }
        }
      }
    }

    // 2. Boolean flags without values or with 1/true: ?no_bt, ?no_browsertrack, ?hide_bt, ?hide_browsertrack
    for (const flag of ['no_bt', 'no_browsertrack', 'hide_bt', 'hide_browsertrack']) {
      if (params.has(flag)) {
        const val = (params.get(flag) || '').toLowerCase().trim();
        if (val === '' || val === '1' || val === 'true' || val === 'yes') {
          return true;
        }
      }
    }

    // 3. Value-based parameters: ?bt=false, ?bt=0, ?bt=hidden, ?bt=off
    if (params.has('bt')) {
      const val = (params.get('bt') || '').toLowerCase().trim();
      if (HIDE_VALUES.has(val)) return true;
    }

    if (params.has('browsertrack')) {
      const val = (params.get('browsertrack') || '').toLowerCase().trim();
      if (HIDE_VALUES.has(val)) return true;
    }

    if (params.has('bt_ui')) {
      const val = (params.get('bt_ui') || '').toLowerCase().trim();
      if (HIDE_VALUES.has(val) || val === '0' || val === 'false') return true;
    }

    if (params.has('bt_hide')) {
      const val = (params.get('bt_hide') || '').toLowerCase().trim();
      if (val === '' || val === '1' || val === 'true') return true;
    }
  } catch {
    // Defensive in non-standard environments
  }

  return false;
}
