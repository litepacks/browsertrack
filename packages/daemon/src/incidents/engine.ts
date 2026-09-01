import crypto from 'node:crypto';
import type {
  ClientEventMessage,
  ConsoleEvent,
  Incident,
  IncidentOccurrence,
  IncidentSeverity,
  NetworkEvent,
  RuntimeErrorEvent,
} from '../../../core/src/index.js';
import { computeFingerprint, extractSourceFromStack, normalizeSourceFile, redactSensitiveData } from '../../../core/src/index.js';
import type { StorageDB } from '../storage/db.js';
import type { ScreenshotStore } from '../storage/screenshot-store.js';

export class IncidentEngine {
  private db: StorageDB;
  private screenshotStore: ScreenshotStore;

  constructor(db: StorageDB, screenshotStore: ScreenshotStore) {
    this.db = db;
    this.screenshotStore = screenshotStore;
  }

  public processClientEvent(message: ClientEventMessage & { screenshot?: string }): Incident | null {
    const session = this.db.getSession(message.sessionId);
    const projectId = session?.projectId || 'default';
    const sanitizedBreadcrumbs = (message.breadcrumbs || []).map((b) => redactSensitiveData(b));
    const sanitizedLastElement = message.lastElement ? redactSensitiveData(message.lastElement) : undefined;

    // Filter network failures from breadcrumbs
    const networkFailures: NetworkEvent[] = sanitizedBreadcrumbs
      .filter((b) => (b.type === 'fetch' || b.type === 'xhr') && b.level === 'error' && b.data)
      .map((b) => ({
        url: b.message.split(' ')[1] || '',
        method: b.message.split(' ')[0] || 'GET',
        status: b.data?.status,
        durationMs: b.data?.durationMs || 0,
        error: b.data?.error,
        aborted: b.data?.aborted,
        timestamp: b.timestamp,
      }));

    if (message.eventType === 'runtime_error' || message.eventType === 'unhandled_rejection') {
      const payload = message.payload as RuntimeErrorEvent;
      return this.handleErrorEvent({
        projectId,
        sessionId: message.sessionId,
        type: payload.errorType || 'runtime_exception',
        severity: 'error',
        message: payload.message || 'Unknown runtime error',
        stack: payload.stack,
        sourceFile: payload.filename,
        line: payload.lineno,
        column: payload.colno,
        route: message.route || '/',
        url: message.url,
        breadcrumbs: sanitizedBreadcrumbs,
        networkFailures,
        lastElement: sanitizedLastElement,
        screenshotDataUrl: message.screenshot,
      });
    }

    if (message.eventType === 'console') {
      const payload = message.payload as ConsoleEvent;
      if (payload.level === 'error') {
        return this.handleErrorEvent({
          projectId,
          sessionId: message.sessionId,
          type: 'console_error',
          severity: 'error',
          message: payload.message,
          stack: payload.stack,
          route: message.route || '/',
          url: message.url,
          breadcrumbs: sanitizedBreadcrumbs,
          networkFailures,
          lastElement: sanitizedLastElement,
          screenshotDataUrl: message.screenshot,
        });
      }
    }

    return null;
  }

  private handleErrorEvent(input: {
    projectId: string;
    sessionId: string;
    type: string;
    severity: IncidentSeverity;
    message: string;
    stack?: string;
    sourceFile?: string;
    line?: number;
    column?: number;
    route: string;
    url: string;
    breadcrumbs: any[];
    networkFailures: NetworkEvent[];
    lastElement?: any;
    screenshotDataUrl?: string;
  }): Incident {
    const extracted = (!input.sourceFile || !input.line) && input.stack ? extractSourceFromStack(input.stack) : null;

    const rawSource = input.sourceFile || extracted?.file || 'unknown_source';
    const sourceFile = normalizeSourceFile(rawSource);
    const line = input.line || extracted?.line || 0;
    const column = input.column || extracted?.column;

    const fingerprint = computeFingerprint({
      type: input.type,
      message: input.message,
      sourceFile,
      line,
      column,
      stack: input.stack,
    });

    const now = new Date().toISOString();
    const existing = this.db.findIncidentByFingerprint(fingerprint);

    if (existing) {
      const updatedOccurrences = existing.occurrences + 1;
      this.db.updateIncidentOccurrence(existing.id, {
        sessionId: input.sessionId,
        lastSeen: now,
        occurrences: updatedOccurrences,
        route: input.route,
        breadcrumbs: input.breadcrumbs,
        lastElement: input.lastElement,
        stack: input.stack,
      });

      // Insert occurrence
      const occurrenceId = `occ_${crypto.randomUUID().slice(0, 8)}`;
      this.db.insertIncidentOccurrence({
        id: occurrenceId,
        incidentId: existing.id,
        sessionId: input.sessionId,
        timestamp: now,
        route: input.route,
        url: input.url,
        stack: input.stack,
        breadcrumbs: input.breadcrumbs,
        lastElement: input.lastElement,
      });

      return {
        ...existing,
        occurrences: updatedOccurrences,
        lastSeen: now,
        breadcrumbs: input.breadcrumbs,
        lastElement: input.lastElement || existing.lastElement,
      };
    }

    // New incident
    const incidentId = `inc_${crypto.randomUUID().slice(0, 8)}`;
    let screenshotPath: string | undefined;

    if (input.screenshotDataUrl) {
      const saved = this.screenshotStore.saveScreenshot(input.projectId, incidentId, 'error', input.screenshotDataUrl);
      if (saved) {
        screenshotPath = saved.filePath;
      }
    }

    const newIncident: Incident = {
      id: incidentId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      type: input.type,
      severity: input.severity,
      message: input.message,
      source: {
        file: sourceFile,
        line,
        column,
      },
      fingerprint,
      route: input.route,
      firstSeen: now,
      lastSeen: now,
      occurrences: 1,
      status: 'OPEN',
      stack: input.stack,
      breadcrumbs: input.breadcrumbs,
      networkFailures: input.networkFailures,
      lastElement: input.lastElement,
      screenshots: screenshotPath ? { error: screenshotPath } : undefined,
    };

    this.db.insertIncident(newIncident);

    // Initial occurrence
    this.db.insertIncidentOccurrence({
      id: `occ_${crypto.randomUUID().slice(0, 8)}`,
      incidentId,
      sessionId: input.sessionId,
      timestamp: now,
      route: input.route,
      url: input.url,
      stack: input.stack,
      breadcrumbs: input.breadcrumbs,
      lastElement: input.lastElement,
    });

    return newIncident;
  }
}
