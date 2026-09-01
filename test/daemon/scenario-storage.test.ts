import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { StorageDB } from '../../packages/daemon/src/storage/db.js';
import { handleToolCall } from '../../packages/mcp/src/handlers.js';
import type { VisualNote } from '../../packages/core/src/index.js';

const TEST_DB = path.join(process.cwd(), 'tmp', 'test-scenario.db');

describe('Scenario & Multi-Step Flow Storage', () => {
  let db: StorageDB;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = new StorageDB(TEST_DB);
    db.upsertProject({
      id: 'proj_e2e',
      name: 'E2E App',
      origin: 'http://localhost:3000',
    });
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('should store sequential scenario steps and retrieve scenario summary and detail', () => {
    const scenarioId = 'scen_checkout_123';
    const title = 'Checkout Promo Flow';

    const step1: VisualNote = {
      id: 'note_s1',
      projectId: 'proj_e2e',
      sessionId: 'sess_1',
      type: 'element',
      message: '1. Click on Cart button',
      route: '/shop',
      url: 'http://localhost:3000/shop',
      viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
      scroll: { scrollX: 0, scrollY: 0 },
      target: {
        selector: '#btn-cart',
        boundingRect: { x: 10, y: 10, width: 50, height: 30, top: 10, left: 10, bottom: 40, right: 60 },
        visible: true,
      },
      scenarioId,
      stepNumber: 1,
      scenarioTitle: title,
      status: 'OPEN',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    const step2: VisualNote = {
      id: 'note_s2',
      projectId: 'proj_e2e',
      sessionId: 'sess_1',
      type: 'element',
      message: '2. Enter coupon code PROMO2026',
      route: '/cart',
      url: 'http://localhost:3000/cart',
      viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
      scroll: { scrollX: 0, scrollY: 0 },
      target: {
        selector: '#input-coupon',
        boundingRect: { x: 50, y: 100, width: 200, height: 40, top: 100, left: 50, bottom: 140, right: 250 },
        visible: true,
      },
      scenarioId,
      stepNumber: 2,
      scenarioTitle: title,
      status: 'OPEN',
      createdAt: '2026-09-01T10:01:00.000Z',
      updatedAt: '2026-09-01T10:01:00.000Z',
    };

    const step3: VisualNote = {
      id: 'note_s3',
      projectId: 'proj_e2e',
      sessionId: 'sess_1',
      type: 'region',
      message: '3. Total price did not calculate discount',
      route: '/cart',
      url: 'http://localhost:3000/cart',
      viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
      scroll: { scrollX: 0, scrollY: 0 },
      region: { x: 50, y: 200, width: 300, height: 100 },
      scenarioId,
      stepNumber: 3,
      scenarioTitle: title,
      status: 'OPEN',
      createdAt: '2026-09-01T10:02:00.000Z',
      updatedAt: '2026-09-01T10:02:00.000Z',
    };

    db.insertNote(step1);
    db.insertNote(step2);
    db.insertNote(step3);

    // Test listScenarios
    const scenarios = db.listScenarios();
    expect(scenarios.length).toBe(1);
    expect(scenarios[0].id).toBe(scenarioId);
    expect(scenarios[0].title).toBe(title);
    expect(scenarios[0].stepsCount).toBe(3);
    expect(scenarios[0].status).toBe('OPEN');

    // Test getScenario
    const detail = db.getScenario(scenarioId);
    expect(detail).not.toBeNull();
    expect(detail!.stepsCount).toBe(3);
    expect(detail!.steps[0].id).toBe('note_s1');
    expect(detail!.steps[0].stepNumber).toBe(1);
    expect(detail!.steps[1].id).toBe('note_s2');
    expect(detail!.steps[1].stepNumber).toBe(2);
    expect(detail!.steps[2].id).toBe('note_s3');
    expect(detail!.steps[2].stepNumber).toBe(3);
  });

  it('should handle list_scenarios and get_scenario MCP tool calls', async () => {
    const scenarioId = 'scen_login_bug';
    const note1: VisualNote = {
      id: 'note_step_1',
      projectId: 'proj_e2e',
      sessionId: 'sess_1',
      type: 'element',
      message: 'Click Sign In',
      route: '/login',
      url: 'http://localhost:3000/login',
      viewport: { width: 1280, height: 800, devicePixelRatio: 1 },
      scroll: { scrollX: 0, scrollY: 0 },
      scenarioId,
      stepNumber: 1,
      scenarioTitle: 'Auth Flow',
      status: 'OPEN',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    };

    db.insertNote(note1);

    const listRes = await handleToolCall('list_scenarios', {}, { db });
    expect(listRes.total).toBe(1);
    expect(listRes.scenarios[0].id).toBe(scenarioId);

    const getRes = await handleToolCall('get_scenario', { scenarioId }, { db });
    expect(getRes.id).toBe(scenarioId);
    expect(getRes.title).toBe('Auth Flow');
    expect(getRes.steps.length).toBe(1);
    expect(getRes.steps[0].stepNumber).toBe(1);

    // Delete scenario
    db.deleteScenario(scenarioId);
    const afterDelete = db.listScenarios();
    expect(afterDelete.length).toBe(0);
  });
});
