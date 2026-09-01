import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { BrowserTrackDaemon } from '../../packages/daemon/src/server/daemon.js';
import { handleToolCall } from '../../packages/mcp/src/handlers.js';

describe('E2E Visual Notes Flow (Client -> Daemon -> MCP -> Verification -> Resolution)', () => {
  let daemon: BrowserTrackDaemon;
  const testPort = 7345;
  let clientWs: WebSocket;
  let assignedSessionId = '';

  beforeAll(async () => {
    daemon = new BrowserTrackDaemon({
      port: testPort,
      host: '127.0.0.1',
      dbPath: ':memory:',
      screenshotsDir: '/tmp/test-e2e-notes-screenshots',
      verbose: false,
    });
    await daemon.start();

    // Connect WebSocket simulating browser client
    await new Promise<void>((resolve, reject) => {
      clientWs = new WebSocket(`ws://127.0.0.1:${testPort}`);
      clientWs.on('open', () => {
        clientWs.send(
          JSON.stringify({
            type: 'hello',
            origin: 'http://localhost:5173',
            url: 'http://localhost:5173/dashboard',
            title: 'Analytics Dashboard',
          })
        );
      });

      clientWs.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'hello_ack') {
          assignedSessionId = msg.sessionId;
          resolve();
        }

        // Handle daemon command dispatches during verify_note
        if (msg.type === 'command') {
          const cmd = msg.command;
          if (cmd.type === 'get_page_state') {
            clientWs.send(
              JSON.stringify({
                type: 'command_response',
                sessionId: assignedSessionId,
                response: {
                  id: cmd.id,
                  ok: true,
                  result: {
                    url: 'http://localhost:5173/dashboard',
                    route: '/dashboard',
                    title: 'Analytics Dashboard',
                    readyState: 'complete',
                  },
                },
              })
            );
          } else if (cmd.type === 'query_element') {
            clientWs.send(
              JSON.stringify({
                type: 'command_response',
                sessionId: assignedSessionId,
                response: {
                  id: cmd.id,
                  ok: true,
                  result: {
                    exists: true,
                    visible: true,
                    boundingRect: { x: 20, y: 80, width: 350, height: 160, top: 80, left: 20, bottom: 240, right: 370 },
                  },
                },
              })
            );
          } else if (cmd.type === 'check_overflow') {
            clientWs.send(
              JSON.stringify({
                type: 'command_response',
                sessionId: assignedSessionId,
                response: {
                  id: cmd.id,
                  ok: true,
                  result: {
                    selector: '#stats-banner',
                    overflow: false, // Overflow fixed!
                    viewportWidth: 390,
                    viewportHeight: 844,
                    overflowRightPx: 0,
                    overflowBottomPx: 0,
                    rect: { x: 20, y: 80, width: 350, height: 160, top: 80, left: 20, bottom: 240, right: 370 },
                  },
                },
              })
            );
          } else if (cmd.type === 'capture_element') {
            clientWs.send(
              JSON.stringify({
                type: 'command_response',
                sessionId: assignedSessionId,
                response: {
                  id: cmd.id,
                  ok: true,
                  result: {
                    format: 'webp',
                    dataUrl: 'data:image/webp;base64,UklGRmYAAABXRUJQVlA4IFoAAAAwAQCdASoBAAEAD8D+JaQAA3AA/ua2wAAA',
                    width: 350,
                    height: 160,
                  },
                },
              })
            );
          }
        }
      });

      clientWs.on('error', reject);
    });
  });

  afterAll(async () => {
    clientWs?.close();
    await daemon.stop();
  });

  it('runs complete lifecycle of a visual note', async () => {
    // 1. Client creates a note on overflowing stats card
    const noteCreatedPromise = new Promise<string>((resolve) => {
      const listener = (raw: any) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'note_created_ack') {
          clientWs.removeListener('message', listener);
          resolve(msg.noteId);
        }
      };
      clientWs.on('message', listener);
    });

    clientWs.send(
      JSON.stringify({
        type: 'create_note',
        sessionId: assignedSessionId,
        noteType: 'element',
        message: "Mobile'da buraya bak, sağa taşıyor",
        route: '/dashboard',
        url: 'http://localhost:5173/dashboard',
        viewport: { width: 390, height: 844, devicePixelRatio: 3 },
        scroll: { scrollX: 0, scrollY: 0 },
        target: {
          selector: '#stats-banner',
          boundingRect: { x: 20, y: 80, width: 440, height: 160, top: 80, left: 20, bottom: 240, right: 460 },
          visible: true,
          confidence: 'high',
        },
        elementContext: {
          selector: '#stats-banner',
          tag: 'div',
          attributes: { id: 'stats-banner' },
          outerHTML: '<div id="stats-banner"><input type="password" value="[REDACTED]" /></div>',
        },
        screenshot: 'data:image/webp;base64,UklGRmYAAABXRUJQVlA4IFoAAAAwAQCdASoBAAEAD8D+JaQAA3AA/ua2wAAA',
      })
    );

    const noteId = await noteCreatedPromise;
    expect(noteId).toMatch(/^note_/);

    // 2. MCP list_notes returns the note
    const mcpCtx = {
      db: daemon.db,
      sessionManager: daemon.sessionManager,
      noteVerificationEngine: daemon.noteVerificationEngine,
    };

    const listRes = await handleToolCall('list_notes', {}, mcpCtx);
    expect(listRes.total).toBe(1);
    expect(listRes.notes[0].id).toBe(noteId);
    expect(listRes.notes[0].status).toBe('OPEN');
    expect(listRes.notes[0].target).toBe('#stats-banner');

    // 3. MCP get_note returns sanitized DOM and screenshot
    const getRes = await handleToolCall('get_note', { noteId }, mcpCtx);
    expect(getRes.id).toBe(noteId);
    expect(getRes.elementContext.outerHTML).toContain('[REDACTED]');
    expect(getRes.screenshot.available).toBe(true);

    // 4. Verify note with layout probes (checks element & viewport overflow)
    const verifyRes = await handleToolCall('verify_note', { noteId, observationWindowMs: 50 }, mcpCtx);
    expect(verifyRes.noteId).toBe(noteId);
    expect(verifyRes.status).toBe('VERIFIED');
    expect(verifyRes.geometryDiff.overflowFixed).toBe(true);
    expect(verifyRes.screenshots.after).toBeDefined();

    // 5. MCP resolve_note marks note as RESOLVED
    const resolveRes = await handleToolCall('resolve_note', { noteId }, mcpCtx);
    expect(resolveRes.ok).toBe(true);
    expect(resolveRes.status).toBe('RESOLVED');

    const finalNote = daemon.db.getNote(noteId);
    expect(finalNote?.status).toBe('RESOLVED');
  });
});
