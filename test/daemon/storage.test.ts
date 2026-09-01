import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StorageDB } from '../../packages/daemon/src/storage/db.js';

describe('StorageDB (SQLite)', () => {
  let tempDbPath: string;
  let db: StorageDB;

  beforeEach(() => {
    tempDbPath = path.join(os.tmpdir(), `bt_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    db = new StorageDB(tempDbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });

  it('should upsert and retrieve projects', () => {
    const project = db.upsertProject({
      id: 'proj_euix',
      name: 'euix',
      origin: 'http://localhost:5173',
      path: '/Users/dev/projects/euix',
    });

    expect(project.id).toBe('proj_euix');
    expect(project.name).toBe('euix');

    const fetched = db.getProject('euix');
    expect(fetched).not.toBeNull();
    expect(fetched?.origin).toBe('http://localhost:5173');
    expect(fetched?.path).toBe('/Users/dev/projects/euix');
  });

  it('should track sessions and query by project', () => {
    db.upsertProject({ id: 'proj_1', name: 'app1', origin: 'http://localhost:3000' });

    db.upsertSession({
      id: 'sess_1',
      projectId: 'proj_1',
      origin: 'http://localhost:3000',
      url: 'http://localhost:3000/dashboard',
      title: 'App Dashboard',
      userAgent: 'Mozilla/5.0 Chrome/120.0',
      connectedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      active: true,
    });

    const activeSessions = db.listSessions('proj_1', true);
    expect(activeSessions.length).toBe(1);
    expect(activeSessions[0].id).toBe('sess_1');

    db.deactivateSession('sess_1');
    const afterDeactivate = db.listSessions('proj_1', true);
    expect(afterDeactivate.length).toBe(0);
  });

  it('should enforce event retention per session', () => {
    const sessionId = 'sess_retention';
    for (let i = 1; i <= 20; i++) {
      db.insertEvent({
        id: `evt_${i}`,
        sessionId,
        eventType: 'console',
        payload: { message: `Log ${i}` },
        timestamp: 1000 + i,
      });
    }

    // Prune to keep only last 5
    db.pruneSessionEvents(sessionId, 5);

    const remaining = db.getEvents({ sessionId, limit: 50 });
    expect(remaining.length).toBe(5);
    expect(remaining[0].id).toBe('evt_20');
    expect(remaining[4].id).toBe('evt_16');
  });

  it('should insert, update, and list incidents', () => {
    const incident = {
      id: 'inc_1',
      projectId: 'proj_test',
      sessionId: 'sess_test',
      type: 'TypeError',
      severity: 'error' as const,
      message: 'Cannot read properties of undefined',
      source: { file: '/src/main.ts', line: 42 },
      fingerprint: 'fp_abc123',
      route: '/home',
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      occurrences: 1,
      status: 'OPEN' as const,
      breadcrumbs: [],
      networkFailures: [],
    };

    db.insertIncident(incident);

    const found = db.findIncidentByFingerprint('fp_abc123');
    expect(found).not.toBeNull();
    expect(found?.id).toBe('inc_1');
    expect(found?.occurrences).toBe(1);

    // Increment occurrence
    db.updateIncidentOccurrence('inc_1', {
      sessionId: 'sess_test',
      lastSeen: new Date().toISOString(),
      occurrences: 2,
      route: '/home',
      breadcrumbs: [],
    });

    const updated = db.getIncident('inc_1');
    expect(updated?.occurrences).toBe(2);
  });
});
