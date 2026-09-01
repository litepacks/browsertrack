import type { WebSocket } from 'ws';
import type { ClientCommand, CommandResponse, Session } from '../../../core/src/index.js';
import type { StorageDB } from '../storage/db.js';

interface ActiveSessionSocket {
  sessionId: string;
  ws: WebSocket;
  origin: string;
  projectId: string;
  pendingCommands: Map<
    string,
    {
      resolve: (res: CommandResponse) => void;
      reject: (err: Error) => void;
      timer: any;
    }
  >;
}

export class SessionManager {
  private activeSockets: Map<string, ActiveSessionSocket> = new Map();
  private db: StorageDB;

  constructor(db: StorageDB) {
    this.db = db;
  }

  public registerSocket(sessionId: string, ws: WebSocket, origin: string, projectId: string): void {
    this.activeSockets.set(sessionId, {
      sessionId,
      ws,
      origin,
      projectId,
      pendingCommands: new Map(),
    });
  }

  public unregisterSocket(sessionId: string): void {
    const active = this.activeSockets.get(sessionId);
    if (active) {
      for (const pending of active.pendingCommands.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Session disconnected before command completed'));
      }
      active.pendingCommands.clear();
      this.activeSockets.delete(sessionId);
      this.db.deactivateSession(sessionId);
    }
  }

  public handleCommandResponse(sessionId: string, response: CommandResponse): void {
    const active = this.activeSockets.get(sessionId);
    if (!active) return;

    const pending = active.pendingCommands.get(response.id);
    if (pending) {
      clearTimeout(pending.timer);
      active.pendingCommands.delete(response.id);
      pending.resolve(response);
    }
  }

  public async sendCommand<T = any>(sessionId: string, command: ClientCommand<T>, timeoutMs = 5000): Promise<CommandResponse> {
    const active = this.activeSockets.get(sessionId);
    if (!active || active.ws.readyState !== 1 /* WebSocket.OPEN */) {
      return {
        id: command.id,
        ok: false,
        error: `Session ${sessionId} is not actively connected`,
      };
    }

    return new Promise<CommandResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        active.pendingCommands.delete(command.id);
        resolve({
          id: command.id,
          ok: false,
          error: `Command ${command.type} timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);

      active.pendingCommands.set(command.id, {
        resolve,
        reject,
        timer,
      });

      try {
        active.ws.send(
          JSON.stringify({
            type: 'command',
            command,
          })
        );
      } catch (err: any) {
        clearTimeout(timer);
        active.pendingCommands.delete(command.id);
        resolve({
          id: command.id,
          ok: false,
          error: err?.message || 'Failed to send command over WebSocket',
        });
      }
    });
  }

  public getActiveSessionForProject(projectId: string): Session | null {
    for (const active of this.activeSockets.values()) {
      if (active.projectId === projectId) {
        return this.db.getSession(active.sessionId);
      }
    }
    return null;
  }

  public getAnyActiveSession(): Session | null {
    const first = this.activeSockets.keys().next().value;
    if (!first) return null;
    return this.db.getSession(first);
  }

  public getActiveCount(): number {
    return this.activeSockets.size;
  }

  public broadcastToProject(projectId: string, message: any): void {
    const raw = typeof message === 'string' ? message : JSON.stringify(message);
    for (const active of this.activeSockets.values()) {
      if (active.projectId === projectId && active.ws.readyState === 1 /* OPEN */) {
        try {
          active.ws.send(raw);
        } catch {}
      }
    }
  }

  public sendToSession(sessionId: string, message: any): void {
    const active = this.activeSockets.get(sessionId);
    if (active && active.ws.readyState === 1) {
      try {
        const raw = typeof message === 'string' ? message : JSON.stringify(message);
        active.ws.send(raw);
      } catch {}
    }
  }
}
