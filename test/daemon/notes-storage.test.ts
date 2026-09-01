import { beforeEach, describe, expect, it } from 'vitest';
import type { VisualNote } from '../../packages/core/src/index.js';
import { StorageDB } from '../../packages/daemon/src/storage/db.js';

describe('Daemon StorageDB - Visual Notes', () => {
  let db: StorageDB;

  beforeEach(() => {
    db = new StorageDB(':memory:');
    db.upsertProject({ id: 'proj_1', name: 'my-app', origin: 'http://localhost:3000' });
    db.upsertSession({
      id: 'sess_1',
      projectId: 'proj_1',
      origin: 'http://localhost:3000',
      connectedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    });
  });

  it('inserts and retrieves a visual note', () => {
    const note: VisualNote = {
      id: 'note_abc123',
      projectId: 'proj_1',
      sessionId: 'sess_1',
      type: 'element',
      message: 'Card text is truncated on small screens',
      route: '/settings',
      url: 'http://localhost:3000/settings',
      viewport: { width: 375, height: 667, devicePixelRatio: 2 },
      scroll: { scrollX: 0, scrollY: 0 },
      target: {
        selector: '.card-title',
        boundingRect: { x: 10, y: 50, width: 200, height: 30, top: 50, left: 10, bottom: 80, right: 210 },
        visible: true,
      },
      elementContext: {
        selector: '.card-title',
        tag: 'h3',
        attributes: { class: 'card-title' },
        outerHTML: '<h3 class="card-title">Settings</h3>',
      },
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.insertNote(note);

    const fetched = db.getNote('note_abc123');
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe('note_abc123');
    expect(fetched?.message).toBe('Card text is truncated on small screens');
    expect(fetched?.viewport.width).toBe(375);
    expect(fetched?.target?.selector).toBe('.card-title');
    expect(fetched?.status).toBe('OPEN');
  });

  it('updates note status to RESOLVED and back to OPEN', () => {
    const note: VisualNote = {
      id: 'note_status_test',
      projectId: 'proj_1',
      sessionId: 'sess_1',
      type: 'page',
      message: 'Header background should be transparent',
      route: '/',
      url: 'http://localhost:3000/',
      viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
      scroll: { scrollX: 0, scrollY: 0 },
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.insertNote(note);
    expect(db.getNote('note_status_test')?.status).toBe('OPEN');

    db.updateNoteStatus('note_status_test', 'RESOLVED');
    const resolved = db.getNote('note_status_test');
    expect(resolved?.status).toBe('RESOLVED');
    expect(resolved?.resolvedAt).toBeDefined();

    db.updateNoteStatus('note_status_test', 'OPEN');
    const reopened = db.getNote('note_status_test');
    expect(reopened?.status).toBe('OPEN');
  });

  it('stores and retrieves note verification records', () => {
    db.insertNote({
      id: 'note_ver_test',
      projectId: 'proj_1',
      sessionId: 'sess_1',
      type: 'element',
      message: 'Fix overflow',
      route: '/home',
      url: 'http://localhost:3000/home',
      viewport: { width: 390, height: 844, devicePixelRatio: 3 },
      scroll: { scrollX: 0, scrollY: 0 },
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    db.insertNoteVerification({
      noteId: 'note_ver_test',
      status: 'VERIFIED',
      checks: [
        { type: 'element_exists', passed: true, details: 'Element found' },
        { type: 'no_viewport_overflow', passed: true, details: 'Fits inside 390px viewport' },
      ],
      geometryDiff: {
        overflowFixed: true,
        viewportWidth: 390,
        overflowPx: 0,
      },
      screenshots: {
        before: '/path/to/before.webp',
        after: '/path/to/after.webp',
      },
      timestamp: new Date().toISOString(),
      message: 'Visual note verified successfully',
    });

    const latest = db.getLatestNoteVerification('note_ver_test');
    expect(latest).toBeDefined();
    expect(latest?.status).toBe('VERIFIED');
    expect(latest?.checks.length).toBe(2);
    expect(latest?.geometryDiff?.overflowFixed).toBe(true);
    expect(latest?.screenshots?.after).toBe('/path/to/after.webp');
  });
});
