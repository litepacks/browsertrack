import http from 'node:http';
import { WebSocketServer } from 'ws';
import type { DaemonConfig } from '../config.js';
import { getDaemonConfig } from '../config.js';
import { IncidentEngine } from '../incidents/engine.js';
import { NotesEngine } from '../notes/engine.js';
import { NoteVerificationEngine } from '../notes/verification.js';
import { SessionManager } from '../session/manager.js';
import { StorageDB } from '../storage/db.js';
import { ScreenshotStore } from '../storage/screenshot-store.js';
import { VerificationEngine } from '../verification/engine.js';
import { createHttpHandler } from './http.js';
import { setupWebSocketServer } from './ws.js';

export class BrowserTrackDaemon {
  public config: DaemonConfig;
  public db: StorageDB;
  public screenshotStore: ScreenshotStore;
  public sessionManager: SessionManager;
  public incidentEngine: IncidentEngine;
  public notesEngine: NotesEngine;
  public verificationEngine: VerificationEngine;
  public noteVerificationEngine: NoteVerificationEngine;

  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private isRunning = false;

  constructor(config: Partial<DaemonConfig> = {}) {
    this.config = getDaemonConfig(config);
    this.db = new StorageDB(this.config.dbPath);
    this.screenshotStore = new ScreenshotStore(this.config.screenshotsDir);
    this.sessionManager = new SessionManager(this.db);
    this.incidentEngine = new IncidentEngine(this.db, this.screenshotStore);
    this.notesEngine = new NotesEngine(this.db, this.screenshotStore);
    this.verificationEngine = new VerificationEngine(this.db, this.sessionManager, this.screenshotStore);
    this.noteVerificationEngine = new NoteVerificationEngine(this.db, this.sessionManager, this.notesEngine);
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    const httpHandler = createHttpHandler(
      this.db,
      this.sessionManager,
      this.config.screenshotsDir,
      this.verificationEngine,
      this.noteVerificationEngine
    );
    this.httpServer = http.createServer(httpHandler);

    this.wss = new WebSocketServer({ server: this.httpServer });
    setupWebSocketServer(
      this.wss,
      this.db,
      this.sessionManager,
      this.incidentEngine,
      this.notesEngine,
      this.config.maxEventsPerSession,
      this.config.verbose
    );

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        this.isRunning = true;
        if (this.config.verbose) {
          console.log(`[BrowserTrack] Daemon running at http://${this.config.host}:${this.config.port}`);
        }
        resolve();
      });

      this.httpServer!.once('error', (err) => {
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.wss) {
      for (const client of this.wss.clients) {
        try {
          client.terminate();
        } catch {}
      }
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    if (this.httpServer) {
      if (typeof (this.httpServer as any).closeAllConnections === 'function') {
        (this.httpServer as any).closeAllConnections();
      }
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    try {
      this.db.close();
    } catch {}
    this.isRunning = false;
  }

  public getStatus(): { isRunning: boolean; host: string; port: number; activeSessions: number; dbPath: string } {
    return {
      isRunning: this.isRunning,
      host: this.config.host,
      port: this.config.port,
      activeSessions: this.sessionManager.getActiveCount(),
      dbPath: this.config.dbPath,
    };
  }
}
