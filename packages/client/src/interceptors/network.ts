import type { NetworkEvent } from '../../../core/src/index.js';
import { redactUrl } from '../../../core/src/index.js';

export type NetworkCallback = (event: NetworkEvent) => void;

/**
 * Patches window.fetch and XMLHttpRequest to track network requests and failures.
 */
export function setupNetworkInterceptors(onNetwork: NetworkCallback): () => void {
  const cleanups: (() => void)[] = [];

  // 1. Patch window.fetch
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    const originalFetch = window.fetch;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const startTime = Date.now();
      let urlStr = '';
      let method = 'GET';

      try {
        if (typeof input === 'string') {
          urlStr = input;
        } else if (input instanceof URL) {
          urlStr = input.toString();
        } else if (input && typeof input === 'object' && 'url' in input) {
          urlStr = input.url;
          method = input.method || 'GET';
        }

        if (init && init.method) {
          method = init.method.toUpperCase();
        }
      } catch {
        urlStr = 'unknown_url';
      }

      const safeUrl = redactUrl(urlStr);

      try {
        const response = await originalFetch.apply(window, [input as any, init]);
        const durationMs = Date.now() - startTime;

        onNetwork({
          url: safeUrl,
          method,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          timestamp: startTime,
        });

        return response;
      } catch (err: any) {
        const durationMs = Date.now() - startTime;
        const isAbort = err?.name === 'AbortError';

        onNetwork({
          url: safeUrl,
          method,
          durationMs,
          error: err?.message || 'Network request failed',
          aborted: isAbort,
          timestamp: startTime,
        });

        throw err;
      }
    };

    cleanups.push(() => {
      window.fetch = originalFetch;
    });
  }

  // 2. Patch XMLHttpRequest
  if (typeof window !== 'undefined' && typeof window.XMLHttpRequest === 'function') {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const originalAbort = XMLHttpRequest.prototype.abort;

    const xhrMap = new WeakMap<XMLHttpRequest, { url: string; method: string; startTime: number; aborted?: boolean }>();

    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: any[]) {
      try {
        const method = String(args[0] || 'GET').toUpperCase();
        const rawUrl = String(args[1] || '');
        xhrMap.set(this, {
          url: redactUrl(rawUrl),
          method,
          startTime: Date.now(),
        });
      } catch {
        // Defensive
      }
      return originalOpen.apply(this, args as any);
    };

    XMLHttpRequest.prototype.abort = function (this: XMLHttpRequest) {
      const meta = xhrMap.get(this);
      if (meta) {
        meta.aborted = true;
      }
      return originalAbort.apply(this);
    };

    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: any) {
      const meta = xhrMap.get(this) || { url: 'unknown_url', method: 'GET', startTime: Date.now() };

      const onComplete = () => {
        try {
          const durationMs = Date.now() - meta.startTime;
          onNetwork({
            url: meta.url,
            method: meta.method,
            status: this.status,
            statusText: this.statusText,
            durationMs,
            aborted: meta.aborted,
            timestamp: meta.startTime,
          });
        } catch {
          // Defensive
        }
      };

      const onError = () => {
        try {
          const durationMs = Date.now() - meta.startTime;
          onNetwork({
            url: meta.url,
            method: meta.method,
            status: this.status || 0,
            durationMs,
            error: 'XHR Network Error',
            aborted: meta.aborted,
            timestamp: meta.startTime,
          });
        } catch {
          // Defensive
        }
      };

      this.addEventListener('load', onComplete, { once: true });
      this.addEventListener('error', onError, { once: true });
      this.addEventListener('timeout', onError, { once: true });

      return originalSend.apply(this, [body]);
    };

    cleanups.push(() => {
      XMLHttpRequest.prototype.open = originalOpen;
      XMLHttpRequest.prototype.send = originalSend;
      XMLHttpRequest.prototype.abort = originalAbort;
    });
  }

  return () => {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {}
    }
  };
}
