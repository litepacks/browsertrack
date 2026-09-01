import type { RuntimeErrorEvent } from '@browserdiag/core';

export type RuntimeErrorCallback = (event: RuntimeErrorEvent, error?: any) => void;

export function setupRuntimeInterceptors(onRuntimeError: RuntimeErrorCallback): () => void {
  if (typeof window === 'undefined') return () => {};

  const errorHandler = (event: ErrorEvent) => {
    try {
      const errorEvent: RuntimeErrorEvent = {
        message: event.message || (event.error && event.error.message) || 'Script error',
        stack: (event.error && event.error.stack) || undefined,
        filename: event.filename || undefined,
        lineno: event.lineno || undefined,
        colno: event.colno || undefined,
        errorType: (event.error && event.error.name) || 'Error',
        timestamp: Date.now(),
      };
      onRuntimeError(errorEvent, event.error);
    } catch {
      // Defensive: never let diagnostic handler crash host app
    }
  };

  const unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
    try {
      const reason = event.reason;
      let message = 'Unhandled Promise Rejection';
      let stack: string | undefined;
      let errorType = 'UnhandledRejection';

      if (reason instanceof Error) {
        message = reason.message;
        stack = reason.stack;
        errorType = reason.name || 'UnhandledRejection';
      } else if (typeof reason === 'string') {
        message = reason;
      } else if (reason && typeof reason === 'object') {
        try {
          message = JSON.stringify(reason);
        } catch {
          message = String(reason);
        }
      }

      const errorEvent: RuntimeErrorEvent = {
        message,
        stack,
        errorType,
        timestamp: Date.now(),
      };
      onRuntimeError(errorEvent, reason);
    } catch {
      // Defensive
    }
  };

  window.addEventListener('error', errorHandler);
  window.addEventListener('unhandledrejection', unhandledRejectionHandler);

  return () => {
    window.removeEventListener('error', errorHandler);
    window.removeEventListener('unhandledrejection', unhandledRejectionHandler);
  };
}
