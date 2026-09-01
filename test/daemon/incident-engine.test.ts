import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IncidentEngine } from '../../packages/daemon/src/incidents/engine.js';
import { StorageDB } from '../../packages/daemon/src/storage/db.js';
import { ScreenshotStore } from '../../packages/daemon/src/storage/screenshot-store.js';

describe('IncidentEngine', () => {
  let tempDir: string;
  let db: StorageDB;
  let screenshotStore: ScreenshotStore;
  let engine: IncidentEngine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt_inc_test_'));
    const dbPath = path.join(tempDir, 'test.db');
    const screenshotsDir = path.join(tempDir, 'screenshots');

    db = new StorageDB(dbPath);
    screenshotStore = new ScreenshotStore(screenshotsDir);
    engine = new IncidentEngine(db, screenshotStore);

    // Setup project and session
    db.upsertProject({ id: 'proj_app', name: 'app', origin: 'http://localhost:5173' });
    db.upsertSession({
      id: 'sess_100',
      projectId: 'proj_app',
      origin: 'http://localhost:5173',
      url: 'http://localhost:5173/dashboard',
      title: 'Dashboard',
      userAgent: 'Chrome/120',
      connectedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      active: true,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create a new incident from a runtime error event', () => {
    const incident = engine.processClientEvent({
      type: 'event',
      sessionId: 'sess_100',
      eventType: 'runtime_error',
      payload: {
        errorType: 'TypeError',
        message: "Cannot read properties of null (reading 'userName')",
        filename: 'http://localhost:5173/src/User.tsx?t=12345',
        lineno: 28,
        colno: 5,
        timestamp: Date.now(),
      },
      route: '/dashboard',
      url: 'http://localhost:5173/dashboard',
      timestamp: Date.now(),
    });

    expect(incident).not.toBeNull();
    expect(incident?.id.startsWith('inc_')).toBe(true);
    expect(incident?.occurrences).toBe(1);
    expect(incident?.status).toBe('OPEN');
    expect(incident?.source.file).toBe('/src/User.tsx');
    expect(incident?.source.line).toBe(28);
  });

  it('should deduplicate recurring errors and increment occurrences', () => {
    const eventPayload = {
      type: 'event' as const,
      sessionId: 'sess_100',
      eventType: 'runtime_error' as const,
      payload: {
        errorType: 'ReferenceError',
        message: 'AuthService is not defined',
        filename: '/src/services/auth.ts',
        lineno: 14,
        timestamp: Date.now(),
      },
      route: '/login',
      url: 'http://localhost:5173/login',
      timestamp: Date.now(),
    };

    const first = engine.processClientEvent(eventPayload);
    const second = engine.processClientEvent(eventPayload);
    const third = engine.processClientEvent(eventPayload);

    expect(first?.id).toBe(second?.id);
    expect(first?.id).toBe(third?.id);
    expect(third?.occurrences).toBe(3);

    const fromDb = db.getIncident(first!.id);
    expect(fromDb?.occurrences).toBe(3);
  });
});
