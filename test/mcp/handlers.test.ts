import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StorageDB } from '../../packages/daemon/src/storage/db.js';
import { handleToolCall } from '../../packages/mcp/src/handlers.js';

describe('MCP Tool Handlers', () => {
  let tempDir: string;
  let db: StorageDB;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt_mcp_test_'));
    const dbPath = path.join(tempDir, 'test.db');
    db = new StorageDB(dbPath);

    // Seed test data
    db.upsertProject({
      id: 'proj_mcp',
      name: 'mcp-app',
      origin: 'http://localhost:3000',
      path: '/Users/test/mcp-app',
    });

    db.upsertSession({
      id: 'sess_mcp_1',
      projectId: 'proj_mcp',
      origin: 'http://localhost:3000',
      url: 'http://localhost:3000/users',
      title: 'Users List',
      userAgent: 'Chrome/120',
      connectedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      active: true,
    });

    db.insertIncident({
      id: 'inc_42',
      projectId: 'proj_mcp',
      sessionId: 'sess_mcp_1',
      type: 'TypeError',
      severity: 'error',
      message: "Cannot read properties of undefined (reading 'avatar')",
      source: { file: '/src/components/UserAvatar.tsx', line: 18, column: 5 },
      fingerprint: 'fp_mcp_user_avatar',
      route: '/users/42',
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      occurrences: 4,
      status: 'OPEN',
      stack: 'TypeError: Cannot read properties...\n at UserAvatar (/src/components/UserAvatar.tsx:18:5)',
      breadcrumbs: [
        { type: 'navigation', message: 'navigate /users', timestamp: Date.now() - 1000 },
        { type: 'click', message: 'click button[data-testid="user-42"]', timestamp: Date.now() - 500 },
      ],
      networkFailures: [
        { url: '/api/users/42', method: 'GET', status: 500, durationMs: 120, timestamp: Date.now() - 300 },
      ],
      lastElement: {
        selector: '[data-testid="user-42"]',
        tag: 'button',
        visible: true,
        innerText: 'View Profile',
      },
    });

    db.insertEvent({
      id: 'evt_log_1',
      sessionId: 'sess_mcp_1',
      eventType: 'console',
      payload: { level: 'error', message: 'Failed to load user image' },
      timestamp: Date.now(),
      route: '/users/42',
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should handle list_projects', async () => {
    const res = await handleToolCall('list_projects', {}, { db });
    expect(res.projects.length).toBe(1);
    expect(res.projects[0].name).toBe('mcp-app');
  });

  it('should handle list_incidents', async () => {
    const res = await handleToolCall('list_incidents', { limit: 10 }, { db });
    expect(res.total).toBe(1);
    expect(res.incidents[0].id).toBe('inc_42');
    expect(res.incidents[0].occurrences).toBe(4);
  });

  it('should handle get_incident with rich debugging context', async () => {
    const res = await handleToolCall('get_incident', { incidentId: 'inc_42' }, { db });
    expect(res.id).toBe('inc_42');
    expect(res.source.file).toBe('/src/components/UserAvatar.tsx');
    expect(res.source.line).toBe(18);
    expect(res.lastInteractedElement?.selector).toBe('[data-testid="user-42"]');
    expect(res.recentBreadcrumbs.length).toBe(2);
    expect(res.networkFailures.length).toBe(1);
  });

  it('should handle get_console', async () => {
    const res = await handleToolCall('get_console', { sessionId: 'sess_mcp_1' }, { db });
    expect(res.logs.length).toBe(1);
    expect(res.logs[0].message).toBe('Failed to load user image');
  });

  it('should handle get_breadcrumbs', async () => {
    const res = await handleToolCall('get_breadcrumbs', { incidentId: 'inc_42' }, { db });
    expect(res.breadcrumbs.length).toBe(2);
    expect(res.breadcrumbs[0].type).toBe('navigation');
  });
});
