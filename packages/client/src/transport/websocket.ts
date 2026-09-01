import type { HelloMessage, ClientCommand, CommandResponse } from '../../../core/src/index.js';
import type { ClientCommandHandler } from '../commands/handler.js';

export interface TransportOptions {
  url: string;
  projectId?: string;
  debug?: boolean;
}

export class WebSocketTransport {
  private wsUrl: string;
  private projectId?: string;
  private debug: boolean;
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private queue: string[] = [];
  private maxQueueSize = 50;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 10000;
  private reconnectTimer: any = null;
  private commandHandler?: ClientCommandHandler;
  private messageListeners: ((msg: any) => void)[] = [];
  private isDestroyed = false;

  constructor(options: TransportOptions) {
    this.wsUrl = options.url || 'ws://127.0.0.1:7331';
    this.projectId = options.projectId;
    this.debug = !!options.debug;
  }

  public setCommandHandler(handler: ClientCommandHandler): void {
    this.commandHandler = handler;
  }

  public onMessage(listener: (msg: any) => void): () => void {
    this.messageListeners.push(listener);
    return () => {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener);
    };
  }

  public getSessionId(): string | null {
    return this.sessionId;
  }

  public isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === (typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1);
  }

  public connect(): void {
    if (this.isDestroyed || typeof WebSocket === 'undefined') return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.sendHello();
        this.flushQueue();
      };

      this.ws.onmessage = async (event: MessageEvent) => {
        try {
          const raw = typeof event.data === 'string' ? event.data : '';
          if (!raw) return;
          const msg = JSON.parse(raw);

          // Dispatch to subscribers (e.g. NoteInspector for notes_sync)
          for (const listener of this.messageListeners) {
            try {
              listener(msg);
            } catch {}
          }

          if (msg.type === 'hello_ack') {
            this.sessionId = msg.sessionId;
            if (this.debug) {
              console.log('[BrowserTrack] Connected, session ID:', this.sessionId);
            }
            return;
          }

          if (msg.type === 'command' && this.commandHandler) {
            const command: ClientCommand = msg.command;
            const res: CommandResponse = await this.commandHandler.executeCommand(command);
            this.send({
              type: 'command_response',
              sessionId: this.sessionId,
              response: res,
            });
          }
        } catch {
          // Defensive
        }
      };

      this.ws.onerror = () => {
        // Silent fail if daemon is offline
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  public send(payload: any): void {
    const raw = JSON.stringify(payload);
    if (this.isConnected()) {
      try {
        this.ws!.send(raw);
      } catch {
        this.enqueue(raw);
      }
    } else {
      this.enqueue(raw);
    }
  }

  private enqueue(raw: string): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
    }
    this.queue.push(raw);
  }

  private flushQueue(): void {
    if (!this.isConnected()) return;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        try {
          this.ws!.send(item);
        } catch {
          this.queue.unshift(item);
          break;
        }
      }
    }
  }

  private sendHello(): void {
    if (typeof window === 'undefined') return;

    const hello: HelloMessage = {
      type: 'hello',
      origin: window.location.origin,
      url: window.location.href,
      title: document.title,
      userAgent: navigator.userAgent,
      timestamp: Date.now(),
      projectId: this.projectId,
    };

    try {
      this.ws!.send(JSON.stringify(hello));
    } catch {
      // Defensive
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed || this.reconnectTimer) return;

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), this.maxReconnectDelay);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  public destroy(): void {
    this.isDestroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.queue = [];
  }
}
