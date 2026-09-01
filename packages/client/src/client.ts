import type {
  Breadcrumb,
  ClientEventMessage,
  ConsoleEvent,
  ElementSummary,
  NavigationEvent,
  NetworkEvent,
  RuntimeErrorEvent,
} from '../../core/src/index.js';
import { BreadcrumbBuffer } from './breadcrumbs.js';
import { ClientCommandHandler } from './commands/handler.js';
import type { BrowserDiagClientOptions } from './config.js';
import { DEFAULT_OPTIONS } from './config.js';
import { setupConsoleInterceptors } from './interceptors/console.js';
import { setupInteractionInterceptors } from './interceptors/interaction.js';
import { setupNavigationInterceptors } from './interceptors/navigation.js';
import { setupNetworkInterceptors } from './interceptors/network.js';
import { setupRuntimeInterceptors } from './interceptors/runtime.js';
import { BrowserScriptScreenshotDriver } from './screenshot/browser-script-driver.js';
import type { ScreenshotDriver } from './screenshot/driver.js';
import { WebSocketTransport } from './transport/websocket.js';
import { NoteInspector } from './notes/inspector.js';

export class BrowserTrackClient {
  public options: Required<Omit<BrowserDiagClientOptions, 'notes'>> & { notes: Required<NonNullable<BrowserDiagClientOptions['notes']>> };
  private breadcrumbs: BreadcrumbBuffer;
  private transport: WebSocketTransport;
  private screenshotDriver: ScreenshotDriver;
  private commandHandler: ClientCommandHandler;
  private inspector?: NoteInspector;
  private lastElement: ElementSummary | undefined;
  private currentRoute = '/';
  private cleanups: (() => void)[] = [];
  private isInitialized = false;

  constructor(options: BrowserDiagClientOptions = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      notes: {
        ...DEFAULT_OPTIONS.notes,
        ...(options.notes || {}),
      },
    };
    this.breadcrumbs = new BreadcrumbBuffer(this.options.maxBreadcrumbs);
    this.transport = new WebSocketTransport({
      url: this.options.daemonUrl,
      projectId: this.options.projectId,
      debug: this.options.debug,
    });
    this.screenshotDriver = new BrowserScriptScreenshotDriver();
    this.commandHandler = new ClientCommandHandler(this.screenshotDriver);
    this.transport.setCommandHandler(this.commandHandler);

    if (this.options.notes.enabled) {
      this.inspector = new NoteInspector(this.transport, this.screenshotDriver, {
        shortcut: this.options.notes.shortcut,
        maskSelectors: this.options.notes.maskSelectors,
      });
    }
  }

  public init(): this {
    if (this.isInitialized || typeof window === 'undefined') return this;
    this.isInitialized = true;

    try {
      this.currentRoute = window.location.pathname + window.location.search;
    } catch {
      this.currentRoute = '/';
    }

    // 1. Connect WebSocket
    this.transport.connect();

    // 2. Setup Runtime error interceptor
    if (this.options.captureErrors) {
      const cleanupRuntime = setupRuntimeInterceptors(async (errEvent) => {
        await this.handleRuntimeError(errEvent);
      });
      this.cleanups.push(cleanupRuntime);
    }

    // 3. Setup Console interceptor
    if (this.options.captureConsole) {
      const cleanupConsole = setupConsoleInterceptors(async (consoleEvent) => {
        await this.handleConsole(consoleEvent);
      });
      this.cleanups.push(cleanupConsole);
    }

    // 4. Setup Network interceptor
    if (this.options.captureNetwork) {
      const cleanupNetwork = setupNetworkInterceptors((netEvent) => {
        this.handleNetwork(netEvent);
      });
      this.cleanups.push(cleanupNetwork);
    }

    // 5. Setup Navigation interceptor
    if (this.options.captureNavigation) {
      const cleanupNav = setupNavigationInterceptors((navEvent) => {
        this.handleNavigation(navEvent);
      });
      this.cleanups.push(cleanupNav);
    }

    // 6. Setup Interaction interceptor
    if (this.options.captureInteractions) {
      const cleanupInteraction = setupInteractionInterceptors((breadcrumb, elSummary) => {
        if (elSummary) {
          this.lastElement = elSummary;
        }
        this.breadcrumbs.add(breadcrumb);
      });
      this.cleanups.push(cleanupInteraction);
    }

    // 7. Setup Visual Note Inspector
    if (this.inspector) {
      this.inspector.init();
    }

    return this;
  }

  public openNoteEditor(el?: HTMLElement, noteType: 'element' | 'page' = 'element'): void {
    if (this.inspector) {
      this.inspector.openNoteEditor(el, noteType);
    }
  }

  public startRegionSelection(): void {
    if (this.inspector) {
      this.inspector.setMode('region');
    }
  }

  public startElementSelection(): void {
    if (this.inspector) {
      this.inspector.setMode('element');
    }
  }

  public setInspectMode(mode: 'element' | 'region' | 'page' | 'idle'): void {
    if (this.inspector) {
      this.inspector.setMode(mode);
    }
  }

  public async createNote(targetEl: HTMLElement, message: string, noteType: 'element' | 'page' = 'element'): Promise<void> {
    if (this.inspector) {
      await this.inspector.saveVisualNote(targetEl, message, noteType);
    }
  }

  private async handleRuntimeError(errorEvent: RuntimeErrorEvent): Promise<void> {
    // Add to breadcrumbs
    this.breadcrumbs.add({
      type: 'error',
      category: 'runtime',
      message: `${errorEvent.errorType}: ${errorEvent.message}`,
      timestamp: errorEvent.timestamp,
      level: 'error',
      data: {
        filename: errorEvent.filename,
        lineno: errorEvent.lineno,
        colno: errorEvent.colno,
      },
    });

    let screenshotDataUrl: string | undefined;
    if (this.options.onErrorScreenshot && this.lastElement?.selector) {
      try {
        const snap = await this.screenshotDriver.captureSelector(this.lastElement.selector);
        if (snap.ok) {
          screenshotDataUrl = snap.dataUrl;
        }
      } catch {
        // Defensive
      }
    }

    this.sendEvent('runtime_error', errorEvent, screenshotDataUrl);
  }

  private async handleConsole(consoleEvent: ConsoleEvent): Promise<void> {
    this.breadcrumbs.add({
      type: 'console',
      category: 'console',
      message: `console.${consoleEvent.level}: ${consoleEvent.message}`,
      timestamp: consoleEvent.timestamp,
      level: consoleEvent.level === 'error' ? 'error' : consoleEvent.level === 'warn' ? 'warn' : 'info',
    });

    if (consoleEvent.level === 'error' || consoleEvent.level === 'warn') {
      this.sendEvent('console', consoleEvent);
    }
  }

  private handleNetwork(netEvent: NetworkEvent): void {
    const isError = (netEvent.status && netEvent.status >= 400) || !!netEvent.error;
    const msg = `${netEvent.method} ${netEvent.url} -> ${netEvent.status || 'ERR'} (${netEvent.durationMs}ms)`;

    this.breadcrumbs.add({
      type: netEvent.id?.startsWith('xhr') ? 'xhr' : 'fetch',
      category: 'network',
      message: msg,
      timestamp: netEvent.timestamp,
      level: isError ? 'error' : 'info',
      data: {
        status: netEvent.status,
        durationMs: netEvent.durationMs,
        error: netEvent.error,
        aborted: netEvent.aborted,
      },
    });

    this.sendEvent('fetch', netEvent);
  }

  private handleNavigation(navEvent: NavigationEvent): void {
    this.currentRoute = navEvent.to;
    this.breadcrumbs.add({
      type: 'navigation',
      category: 'navigation',
      message: `navigate ${navEvent.to} (${navEvent.type})`,
      timestamp: navEvent.timestamp,
      level: 'info',
      data: { from: navEvent.from, to: navEvent.to, type: navEvent.type },
    });

    this.sendEvent('navigation', navEvent);
  }

  private sendEvent(eventType: any, payload: any, screenshotDataUrl?: string): void {
    if (typeof window === 'undefined') return;

    const message: ClientEventMessage & { screenshot?: string } = {
      type: 'event',
      sessionId: this.transport.getSessionId() || '',
      eventType,
      payload,
      breadcrumbs: this.breadcrumbs.getRecent(),
      lastElement: this.lastElement,
      route: this.currentRoute,
      url: window.location.href,
      title: document.title,
      timestamp: Date.now(),
      screenshot: screenshotDataUrl,
    };

    this.transport.send(message);
  }

  public getBreadcrumbs(): Breadcrumb[] {
    return this.breadcrumbs.getRecent();
  }

  public getLastElement(): ElementSummary | undefined {
    return this.lastElement;
  }

  public destroy(): void {
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch {}
    }
    this.cleanups = [];
    this.transport.destroy();
    if (this.inspector) {
      this.inspector.destroy();
    }
    this.breadcrumbs.clear();
    this.isInitialized = false;
  }
}
