import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createDaemon } from '../../packages/daemon/src/index.js';
import { handleToolCall } from '../../packages/mcp/src/handlers.js';

describe('BrowserTrack Full E2E Lifecycle (Daemon + WebSocket Client + MCP)', () => {
  let tempDir: string;
  let daemon: ReturnType<typeof createDaemon>;
  let wsClient: WebSocket | null = null;
  const testPort = 7339;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt_e2e_'));
    const dbPath = path.join(tempDir, 'e2e.db');
    const screenshotsDir = path.join(tempDir, 'screenshots');

    daemon = createDaemon({
      port: testPort,
      host: '127.0.0.1',
      dbPath,
      screenshotsDir,
      verbose: false,
    });

    await daemon.start();
  });

  afterEach(async () => {
    if (wsClient) {
      wsClient.close();
      wsClient = null;
    }
    await daemon.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should complete full cycle: handshake -> error ingestion -> incident creation -> MCP tool query -> command dispatch', async () => {
    let receivedSessionId = '';

    // 1. Connect WebSocket client (simulating browser)
    wsClient = new WebSocket(`ws://127.0.0.1:${testPort}`);

    await new Promise<void>((resolve) => {
      wsClient!.on('open', () => {
        // Send hello
        wsClient!.send(
          JSON.stringify({
            type: 'hello',
            origin: 'http://localhost:5173',
            url: 'http://localhost:5173/products/123',
            title: 'Product Details',
            userAgent: 'Mozilla/5.0 TestBrowser',
            timestamp: Date.now(),
          })
        );
      });

      wsClient!.on('message', (raw: string | Buffer) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'hello_ack') {
          receivedSessionId = msg.sessionId;
          resolve();
        }
      });
    });

    expect(receivedSessionId.startsWith('sess_')).toBe(true);

    // 2. Browser client triggers runtime error
    wsClient.send(
      JSON.stringify({
        type: 'event',
        sessionId: receivedSessionId,
        eventType: 'runtime_error',
        payload: {
          errorType: 'TypeError',
          message: 'Cannot read property price of undefined',
          filename: 'http://localhost:5173/src/components/ProductCard.tsx',
          lineno: 45,
          colno: 12,
          timestamp: Date.now(),
        },
        breadcrumbs: [
          { type: 'navigation', message: 'navigate /products/123', timestamp: Date.now() - 200 },
          { type: 'click', message: 'click button.add-to-cart', timestamp: Date.now() - 100 },
        ],
        lastElement: {
          selector: 'button.add-to-cart',
          tag: 'button',
          visible: true,
          innerText: 'Add to Cart',
        },
        route: '/products/123',
        url: 'http://localhost:5173/products/123',
        timestamp: Date.now(),
      })
    );

    // Wait a brief tick for SQLite write
    await new Promise((r) => setTimeout(r, 100));

    // 3. MCP query: list_incidents
    const listRes = await handleToolCall('list_incidents', {}, { db: daemon.db });
    expect(listRes.total).toBe(1);
    const incidentId = listRes.incidents[0].id;
    expect(incidentId.startsWith('inc_')).toBe(true);
    expect(listRes.incidents[0].message).toBe('Cannot read property price of undefined');

    // 4. MCP query: get_incident
    const getRes = await handleToolCall('get_incident', { incidentId }, { db: daemon.db });
    expect(getRes.id).toBe(incidentId);
    expect(getRes.source.file).toBe('/src/components/ProductCard.tsx');
    expect(getRes.source.line).toBe(45);
    expect(getRes.lastInteractedElement?.selector).toBe('button.add-to-cart');
    expect(getRes.recentBreadcrumbs.length).toBe(2);

    // 5. Test Live Command: get_page_state via daemon session manager
    // Setup client listener to reply to get_page_state command
    wsClient.on('message', (raw: string | Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'command' && msg.command.type === 'get_page_state') {
        wsClient!.send(
          JSON.stringify({
            type: 'command_response',
            sessionId: receivedSessionId,
            response: {
              id: msg.command.id,
              ok: true,
              result: {
                url: 'http://localhost:5173/products/123',
                route: '/products/123',
                title: 'Product Details',
                readyState: 'complete',
              },
            },
          })
        );
      }
    });

    const pageState = await handleToolCall(
      'get_page_state',
      { sessionId: receivedSessionId },
      { db: daemon.db, sessionManager: daemon.sessionManager }
    );

    expect(pageState.url).toBe('http://localhost:5173/products/123');
    expect(pageState.title).toBe('Product Details');
  });
});
