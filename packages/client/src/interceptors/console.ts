import type { ConsoleEvent, ConsoleLevel } from '../../../core/src/index.js';

export type ConsoleCallback = (event: ConsoleEvent) => void;

/**
 * Patches console methods without modifying original behavior.
 */
export function setupConsoleInterceptors(onConsole: ConsoleCallback): () => void {
  if (typeof console === 'undefined') return () => {};

  const originalError = console.error;
  const originalWarn = console.warn;

  function formatArgs(args: any[]): string {
    return args
      .map((arg) => {
        if (arg instanceof Error) {
          return arg.stack || `${arg.name}: ${arg.message}`;
        }
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ');
  }

  console.error = function (...args: any[]) {
    try {
      const message = formatArgs(args);
      const stack = new Error().stack;
      onConsole({
        level: 'error',
        message,
        stack,
        timestamp: Date.now(),
      });
    } catch {
      // Defensive
    }
    return originalError.apply(console, args);
  };

  console.warn = function (...args: any[]) {
    try {
      const message = formatArgs(args);
      const stack = new Error().stack;
      onConsole({
        level: 'warn',
        message,
        stack,
        timestamp: Date.now(),
      });
    } catch {
      // Defensive
    }
    return originalWarn.apply(console, args);
  };

  return () => {
    console.error = originalError;
    console.warn = originalWarn;
  };
}
