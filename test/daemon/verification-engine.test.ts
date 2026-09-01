import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionManager } from '../../packages/daemon/src/session/manager.js';
import { StorageDB } from '../../packages/daemon/src/storage/db.js';
import { ScreenshotStore } from '../../packages/daemon/src/storage/screenshot-store.js';
import { VerificationEngine } from '../../packages/daemon/src/verification/engine.js';

describe('VerificationEngine', () => {
  let tempDir: string;
  let db: StorageDB;
  let screenshotStore: ScreenshotStore;
  let sessionManager: SessionManager;
  let verificationEngine: VerificationEngine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt_ver_test_'));
    const dbPath = path.join(tempDir, 'test.db');
    const screenshotsDir = path.join(tempDir, 'screenshots');

    db = new StorageDB(dbPath);
    screenshotStore = new ScreenshotStore(screenshotsDir);
    sessionManager = new SessionManager(db);
    verificationEngine = new VerificationEngine(db, sessionManager, screenshotStore);

    db.upsertProject({ id: 'proj_demo', name: 'demo', origin: 'http://localhost:5173' });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return INCONCLUSIVE when no active session is connected to browser', async () => {
    db.insertIncident({
      id: 'inc_test_1',
      projectId: 'proj_demo',
      sessionId: 'sess_inactive',
      type: 'TypeError',
      severity: 'error',
      message: 'Cannot read properties of null',
      source: { file: '/src/main.ts', line: 10 },
      fingerprint: 'fp_test_1',
      route: '/app',
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      occurrences: 1,
      status: 'OPEN',
      breadcrumbs: [],
      networkFailures: [],
    });

    const result = await verificationEngine.verifyIncident('inc_test_1');
    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.message).toContain('No active browser session');
  });

  it('should record verification result in database and update incident status', async () => {
    db.insertIncident({
      id: 'inc_test_2',
      projectId: 'proj_demo',
      sessionId: 'sess_inactive',
      type: 'ReferenceError',
      severity: 'error',
      message: 'Button not found',
      source: { file: '/src/app.ts', line: 20 },
      fingerprint: 'fp_test_2',
      route: '/app',
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      occurrences: 1,
      status: 'OPEN',
      breadcrumbs: [],
      networkFailures: [],
    });

    await verificationEngine.verifyIncident('inc_test_2');

    const latest = db.getLatestVerification('inc_test_2');
    expect(latest).not.toBeNull();
    expect(latest?.incidentId).toBe('inc_test_2');
    expect(latest?.status).toBe('INCONCLUSIVE');

    const updatedInc = db.getIncident('inc_test_2');
    expect(updatedInc?.status).toBe('INCONCLUSIVE');
  });
});
