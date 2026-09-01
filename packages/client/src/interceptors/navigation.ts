import type { NavigationEvent } from '../../../core/src/index.js';
import { redactUrl } from '../../../core/src/index.js';

export type NavigationCallback = (event: NavigationEvent) => void;

/**
 * Tracks browser SPA routing and history navigation.
 */
export function setupNavigationInterceptors(onNavigation: NavigationCallback): () => void {
  if (typeof window === 'undefined' || typeof history === 'undefined') return () => {};

  let currentUrl = redactUrl(window.location.href);

  // Initial navigation
  onNavigation({
    to: currentUrl,
    type: 'initial',
    timestamp: Date.now(),
  });

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (data: any, unused: string, url?: string | URL | null) {
    const from = currentUrl;
    const result = originalPushState.apply(history, [data, unused, url]);
    try {
      const to = redactUrl(window.location.href);
      currentUrl = to;
      onNavigation({
        from,
        to,
        type: 'pushState',
        timestamp: Date.now(),
      });
    } catch {
      // Defensive
    }
    return result;
  };

  history.replaceState = function (data: any, unused: string, url?: string | URL | null) {
    const from = currentUrl;
    const result = originalReplaceState.apply(history, [data, unused, url]);
    try {
      const to = redactUrl(window.location.href);
      currentUrl = to;
      onNavigation({
        from,
        to,
        type: 'replaceState',
        timestamp: Date.now(),
      });
    } catch {
      // Defensive
    }
    return result;
  };

  const onPopState = () => {
    const from = currentUrl;
    const to = redactUrl(window.location.href);
    currentUrl = to;
    onNavigation({
      from,
      to,
      type: 'popstate',
      timestamp: Date.now(),
    });
  };

  const onHashChange = () => {
    const from = currentUrl;
    const to = redactUrl(window.location.href);
    currentUrl = to;
    onNavigation({
      from,
      to,
      type: 'hashchange',
      timestamp: Date.now(),
    });
  };

  window.addEventListener('popstate', onPopState);
  window.addEventListener('hashchange', onHashChange);

  return () => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('hashchange', onHashChange);
  };
}
