import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import type { VisualNote } from '../../../core/src/index.js';
import type { StorageDB } from '../storage/db.js';
import type { ScreenshotStore } from '../storage/screenshot-store.js';

export class NotesEngine {
  private db: StorageDB;
  private screenshotStore: ScreenshotStore;

  constructor(db: StorageDB, screenshotStore: ScreenshotStore) {
    this.db = db;
    this.screenshotStore = screenshotStore;
  }

  public createNoteFromClient(payload: {
    sessionId: string;
    noteType?: 'element' | 'region' | 'page';
    message: string;
    route?: string;
    url?: string;
    viewport?: { width: number; height: number; devicePixelRatio: number };
    scroll?: { scrollX: number; scrollY: number };
    target?: any;
    elementContext?: any;
    region?: any;
    screenshot?: string;
    incidentId?: string;
  }): VisualNote {
    const session = this.db.getSession(payload.sessionId);
    const projectId = session?.projectId || 'default';
    const noteId = `note_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    let screenshotPath: string | undefined;
    if (payload.screenshot) {
      const saved = this.saveNoteScreenshot(projectId, noteId, 'original', payload.screenshot);
      if (saved) {
        screenshotPath = saved;
      }
    }

    const note: VisualNote = {
      id: noteId,
      projectId,
      sessionId: payload.sessionId,
      type: payload.noteType || 'element',
      message: payload.message,
      route: payload.route || '/',
      url: payload.url || '',
      viewport: payload.viewport || { width: 1280, height: 800, devicePixelRatio: 1 },
      scroll: payload.scroll || { scrollX: 0, scrollY: 0 },
      target: payload.target,
      elementContext: payload.elementContext,
      region: payload.region,
      status: 'OPEN',
      incidentId: payload.incidentId,
      screenshots: screenshotPath ? { original: screenshotPath } : undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insertNote(note);
    return note;
  }

  public saveNoteScreenshot(projectId: string, noteId: string, name: string, dataUrl: string): string | null {
    try {
      if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;

      const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
      if (!match) return null;

      let format = match[1].toLowerCase();
      if (format === 'jpeg') format = 'jpg';
      const base64Data = match[2];
      const buffer = Buffer.from(base64Data, 'base64');

      const targetDir = path.join((this.screenshotStore as any).baseDir, projectId || 'default', 'notes', noteId);
      fs.mkdirSync(targetDir, { recursive: true });

      const fileName = `${name}.${format}`;
      const filePath = path.join(targetDir, fileName);

      fs.writeFileSync(filePath, buffer);
      return filePath;
    } catch {
      return null;
    }
  }
}
