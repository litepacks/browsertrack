import { beforeEach, describe, expect, it } from 'vitest';
import { StorageDB } from '../../packages/daemon/src/storage/db.js';
import { ScreenshotStore } from '../../packages/daemon/src/storage/screenshot-store.js';
import { SessionManager } from '../../packages/daemon/src/session/manager.js';
import { NotesEngine } from '../../packages/daemon/src/notes/engine.js';
import { NoteVerificationEngine } from '../../packages/daemon/src/notes/verification.js';

describe('NoteVerificationEngine - Layout Probes & Verification', () => {
  let db: StorageDB;
  let screenshotStore: ScreenshotStore;
  let sessionManager: SessionManager;
  let notesEngine: NotesEngine;
  let noteVerifier: NoteVerificationEngine;

  beforeEach(() => {
    db = new StorageDB(':memory:');
    screenshotStore = new ScreenshotStore('/tmp/test-notes-screenshots');
    sessionManager = new SessionManager(db);
    notesEngine = new NotesEngine(db, screenshotStore);
    noteVerifier = new NoteVerificationEngine(db, sessionManager, notesEngine);

    db.upsertProject({ id: 'proj_notes', name: 'notes-app', origin: 'http://localhost:3000' });
    db.upsertSession({
      id: 'sess_live',
      projectId: 'proj_notes',
      origin: 'http://localhost:3000',
      connectedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
  });

  it('returns INCONCLUSIVE when no active session is connected', async () => {
    db.insertNote({
      id: 'note_no_sess',
      projectId: 'proj_notes',
      sessionId: 'sess_live',
      type: 'element',
      message: 'Check responsive card',
      route: '/',
      url: 'http://localhost:3000/',
      viewport: { width: 390, height: 844, devicePixelRatio: 3 },
      scroll: { scrollX: 0, scrollY: 0 },
      target: {
        selector: '.card',
        boundingRect: { x: 0, y: 0, width: 420, height: 200, top: 0, left: 0, bottom: 200, right: 420 },
        visible: true,
      },
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await noteVerifier.verifyNote('note_no_sess');
    expect(res.status).toBe('INCONCLUSIVE');
    expect(res.message).toContain('No active browser session');
  });

  it('verifies note with layout overflow fixed when session responds', async () => {
    // Mock connected socket
    const fakeSocket: any = {
      readyState: 1,
      send: (data: string) => {
        const wrapper = JSON.parse(data);
        const cmd = wrapper.command;
        if (!cmd) return;

        if (cmd.type === 'get_page_state') {
          sessionManager.handleCommandResponse('sess_live', {
            id: cmd.id,
            ok: true,
            result: { route: '/', title: 'Test App', readyState: 'complete', url: 'http://localhost:3000/' },
          });
        } else if (cmd.type === 'query_element') {
          sessionManager.handleCommandResponse('sess_live', {
            id: cmd.id,
            ok: true,
            result: {
              exists: true,
              visible: true,
              boundingRect: { x: 0, y: 0, width: 350, height: 180, top: 0, left: 0, bottom: 180, right: 350 },
            },
          });
        } else if (cmd.type === 'check_overflow') {
          sessionManager.handleCommandResponse('sess_live', {
            id: cmd.id,
            ok: true,
            result: {
              selector: '.card',
              overflow: false,
              viewportWidth: 390,
              viewportHeight: 844,
              overflowRightPx: 0,
              overflowBottomPx: 0,
              rect: { x: 0, y: 0, width: 350, height: 180, top: 0, left: 0, bottom: 180, right: 350 },
            },
          });
        } else if (cmd.type === 'capture_element') {
          sessionManager.handleCommandResponse('sess_live', {
            id: cmd.id,
            ok: true,
            result: { dataUrl: 'data:image/webp;base64,UklGRmYAAABXRUJQVlA4IFoAAAAwAQCdASoBAAEAD8D+JaQAA3AA/ua2wAAA', format: 'webp', width: 350, height: 180 },
          });
        }
      },
    };

    sessionManager.registerSocket('sess_live', fakeSocket, 'http://localhost:3000', 'proj_notes');

    db.insertNote({
      id: 'note_fixed_ovf',
      projectId: 'proj_notes',
      sessionId: 'sess_live',
      type: 'element',
      message: "Mobile'da buraya bak, sağa taşıyor",
      route: '/',
      url: 'http://localhost:3000/',
      viewport: { width: 390, height: 844, devicePixelRatio: 3 },
      scroll: { scrollX: 0, scrollY: 0 },
      target: {
        selector: '.card',
        boundingRect: { x: 0, y: 0, width: 440, height: 200, top: 0, left: 0, bottom: 200, right: 440 },
        visible: true,
      },
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await noteVerifier.verifyNote('note_fixed_ovf');
    expect(res.status).toBe('VERIFIED');
    expect(res.geometryDiff?.overflowFixed).toBe(true);
    expect(res.geometryDiff?.current?.width).toBe(350);
    expect(res.checks.some((c) => c.type === 'no_viewport_overflow' && c.passed)).toBe(true);
  });
});
