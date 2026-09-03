/**
 * BrowserTrack Safety & Error-Resilience Utilities
 * Provides bulletproof try/catch wrappers, circular-safe JSON serialization, and defensive helpers.
 */

/**
 * Safely parses a JSON string with fallback. Never throws.
 */
export function safeJsonParse<T>(raw: any, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw !== 'string') return typeof raw === 'object' ? (raw as T) : fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Safely serializes an object to JSON, handling circular references and non-serializable values.
 * Never throws "TypeError: Converting circular structure to JSON".
 */
export function safeJsonStringify(val: any, fallback = '{}'): string {
  if (val === undefined) return fallback;
  try {
    const seen = new WeakSet();
    return JSON.stringify(val, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    });
  } catch {
    try {
      return JSON.stringify(String(val));
    } catch {
      return fallback;
    }
  }
}

/**
 * Executes a synchronous function within an isolated try/catch block.
 * Returns the function result, or fallback if an exception was thrown.
 */
export function safeExecute<T>(fn: () => T, fallback: T, onError?: (err: any) => void): T {
  try {
    return fn();
  } catch (err: any) {
    if (onError) {
      try {
        onError(err);
      } catch {}
    }
    return fallback;
  }
}

/**
 * Executes an asynchronous promise or async function safely without unhandled rejection.
 */
export async function safeAsync<T>(
  action: Promise<T> | (() => Promise<T>),
  fallback: T,
  onError?: (err: any) => void
): Promise<T> {
  try {
    if (typeof action === 'function') {
      return await action();
    }
    return await action;
  } catch (err: any) {
    if (onError) {
      try {
        onError(err);
      } catch {}
    }
    return fallback;
  }
}
