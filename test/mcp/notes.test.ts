import { beforeEach, describe, expect, it } from 'vitest';
import { StorageDB } from '../../packages/daemon/src/storage/db.js';
import { ScreenshotStore } from '../../packages/daemon/src/storage/screenshot-store.js';
import { SessionManager } from '../../packages/daemon/src/session/manager.js';
import { NotesEngine } from '../../packages/daemon/src/notes/engine.js';
import { NoteVerificationEngine } from '../../packages/daemon/src/notes/verification.js';
import { handleToolCall } from '../../packages/mcp/src/handlers.js';

describe('MCP Tools - Visual Notes', () => {
  let db: StorageDB;
  let screenshotStore: ScreenshotStore;
  let sessionManager: SessionManager;
  let notesEngine: NotesEngine;
  let noteVerificationEngine: NoteVerificationEngine;

  beforeEach(() => {
    db = new StorageDB(':memory:');
    screenshotStore = new ScreenshotStore('/tmp/test-mcp-notes');
    sessionManager = new SessionManager(db);
    notesEngine = new NotesEngine(db, screenshotStore);
    noteVerificationEngine = new NoteVerificationEngine(db, sessionManager, notesEngine);

    db.upsertProject({ id: 'proj_mcp', name: 'store-app', origin: 'http://localhost:5173' });
    db.upsertSession({
      id: 'sess_mcp',
      projectId: 'proj_mcp',
      origin: 'http://localhost:5173',
      connectedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });

    db.insertNote({
      id: 'note_mcp_1',
      projectId: 'proj_mcp',
      sessionId: 'sess_mcp',
      type: 'element',
      message: 'Mobile nav hamburger button is misaligned',
      route: '/checkout',
      url: 'http://localhost:5173/checkout',
      viewport: { width: 390, height: 844, devicePixelRatio: 3 },
      scroll: { scrollX: 0, scrollY: 0 },
      target: {
        selector: '#nav-hamburger',
        boundingRect: { x: 340, y: 15, width: 40, height: 40, top: 15, left: 340, bottom: 55, right: 380 },
        visible: true,
      },
      elementContext: {
        selector: '#nav-hamburger',
        tag: 'button',
        attributes: { id: 'nav-hamburger', 'aria-label': 'Menu' },
        outerHTML: '<button id="nav-hamburger" aria-label="Menu"><span></span></button>',
      },
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it('lists visual notes via list_notes tool', async () => {
    const res = await handleToolCall(
      'list_notes',
      { projectId: 'proj_mcp' },
      { db, sessionManager, noteVerificationEngine }
    );

    expect(res.total).toBe(1);
    expect(res.notes[0].id).toBe('note_mcp_1');
    expect(res.notes[0].route).toBe('/checkout');
    expect(res.notes[0].target).toBe('#nav-hamburger');
    expect(res.notes[0].message).toBe('Mobile nav hamburger button is misaligned');
  });

  it('retrieves note debugging context via get_note tool', async () => {
    const res = await handleToolCall(
      'get_note',
      { noteId: 'note_mcp_1' },
      { db, sessionManager, noteVerificationEngine }
    );

    expect(res.id).toBe('note_mcp_1');
    expect(res.type).toBe('element');
    expect(res.viewport.width).toBe(390);
    expect(res.elementContext.tag).toBe('button');
    expect(res.project.name).toBe('store-app');
    expect(res.status).toBe('OPEN');
  });

  it('resolves and reopens note via resolve_note and reopen_note tools', async () => {
    const resolveRes = await handleToolCall(
      'resolve_note',
      { noteId: 'note_mcp_1' },
      { db, sessionManager, noteVerificationEngine }
    );
    expect(resolveRes.ok).toBe(true);
    expect(resolveRes.status).toBe('RESOLVED');
    expect(db.getNote('note_mcp_1')?.status).toBe('RESOLVED');

    const reopenRes = await handleToolCall(
      'reopen_note',
      { noteId: 'note_mcp_1' },
      { db, sessionManager, noteVerificationEngine }
    );
    expect(reopenRes.ok).toBe(true);
    expect(reopenRes.status).toBe('OPEN');
    expect(db.getNote('note_mcp_1')?.status).toBe('OPEN');
  });
});
