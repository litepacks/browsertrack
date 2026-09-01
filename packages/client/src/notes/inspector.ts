import type { ElementContext, NoteTarget, RegionContext, VisualNote } from '../../../core/src/index.js';
import { getSemanticSelector, truncate } from '../../../core/src/index.js';
import type { ScreenshotDriver } from '../screenshot/driver.js';
import type { WebSocketTransport } from '../transport/websocket.js';

export type NoteInspectMode = 'element' | 'region' | 'page' | 'idle';

export interface InspectorOptions {
  shortcut?: string; // e.g. "Alt+Click"
  maskSelectors?: string[];
  showToolbar?: boolean;
  onNoteCreated?: (note: Partial<VisualNote>) => void;
}

/**
 * Isolated Visual Note Inspector rendering in Shadow DOM.
 * Supports:
 * 1. Element selection (hover highlight & click)
 * 2. Region / Area selection (drag-and-drop rectangle on screen with cancel banner)
 * 3. Whole page note
 * 4. Real-time Saved Note Markers (pins on elements/regions when page loads or syncs)
 * 5. Interactive Note Detail Card (view message, target, resolve/delete actions)
 * 6. Floating quick dock / toolbar in bottom-right corner with Notes count toggle
 */
export class NoteInspector {
  private transport: WebSocketTransport;
  private screenshotDriver: ScreenshotDriver;
  private options: InspectorOptions;

  private container: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private highlightOverlay: HTMLDivElement | null = null;
  private regionOverlay: HTMLDivElement | null = null;
  private regionBox: HTMLDivElement | null = null;
  private regionBanner: HTMLDivElement | null = null;
  private markersContainer: HTMLDivElement | null = null;
  private toolbarElement: HTMLDivElement | null = null;
  private modalOverlay: HTMLDivElement | null = null;
  private cardOverlay: HTMLDivElement | null = null;

  private activeMode: NoteInspectMode = 'idle';
  private hoveredElement: HTMLElement | null = null;
  private selectedElement: HTMLElement | null = null;
  private selectedRegion: RegionContext | null = null;

  private isDraggingRegion = false;
  private dragStartX = 0;
  private dragStartY = 0;

  private savedNotes: VisualNote[] = [];
  private showMarkers = true;
  private cleanups: (() => void)[] = [];

  constructor(transport: WebSocketTransport, screenshotDriver: ScreenshotDriver, options: InspectorOptions = {}) {
    this.transport = transport;
    this.screenshotDriver = screenshotDriver;
    this.options = {
      shortcut: 'Alt+Click',
      maskSelectors: ['input[type="password"]', '[data-sensitive]'],
      showToolbar: true,
      ...options,
    };
  }

  public init(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this.ensureContainer();
      });
    } else {
      this.ensureContainer();
    }

    // Subscribe to incoming notes synchronization from daemon
    const unsubscribe = this.transport.onMessage((msg) => {
      if (msg && msg.type === 'notes_sync' && Array.isArray(msg.notes)) {
        this.syncNotes(msg.notes);
      }
    });
    this.cleanups.push(unsubscribe);

    this.setupListeners();
  }

  public syncNotes(notes: VisualNote[]): void {
    this.savedNotes = notes;
    this.updateToolbarCount();
    this.renderMarkers();
  }

  public setMode(mode: NoteInspectMode): void {
    this.activeMode = mode;
    this.updateToolbarState();

    if (mode === 'element') {
      this.hideRegionOverlay();
    } else if (mode === 'region') {
      this.hideHighlight();
      this.showRegionOverlay();
    } else if (mode === 'page') {
      this.hideRegionOverlay();
      this.hideHighlight();
      this.openNoteEditor(document.body, 'page');
    } else {
      this.hideRegionOverlay();
      this.hideHighlight();
    }
  }

  private ensureContainer(): ShadowRoot | null {
    if (typeof document === 'undefined') return null;

    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'browsertrack-inspector-host';
      this.container.style.cssText =
        'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';

      this.shadowRoot = this.container.attachShadow({ mode: 'open' });

      // Styles for highlight overlay, region drag box, markers, floating toolbar and modals
      const style = document.createElement('style');
      style.textContent = `
        :host {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          color-scheme: dark;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        
        /* 1. Element Highlight Overlay */
        .bt-highlight {
          position: fixed;
          border: 2px solid #3b82f6;
          background: rgba(59, 130, 246, 0.16);
          border-radius: 4px;
          pointer-events: none;
          transition: all 0.05s ease-out;
          z-index: 2147483640;
          box-sizing: border-box;
        }

        .bt-badge {
          position: absolute;
          top: -26px;
          left: 0;
          background: #0f172a;
          color: #38bdf8;
          border: 1px solid #3b82f6;
          font-size: 11px;
          font-weight: 600;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          padding: 2px 7px;
          border-radius: 4px;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.5);
        }

        /* 2. Region Selection Overlay */
        .bt-region-overlay {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          cursor: crosshair;
          z-index: 2147483642;
          pointer-events: auto;
          background: rgba(15, 23, 42, 0.25);
          user-select: none;
        }

        .bt-region-box {
          position: fixed;
          border: 2px dashed #38bdf8;
          background: rgba(56, 189, 248, 0.2);
          box-sizing: border-box;
          pointer-events: none;
          z-index: 2147483643;
        }

        .bt-region-badge {
          position: absolute;
          top: -26px;
          left: 0;
          background: #0f172a;
          color: #38bdf8;
          border: 1px solid #0284c7;
          font-size: 11px;
          font-weight: 600;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          padding: 2px 7px;
          border-radius: 4px;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 4px 6px -1px rgba(0,0,0,0.5);
        }

        .bt-region-banner {
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: #0f172a;
          color: #f8fafc;
          border: 1px solid #0284c7;
          border-radius: 30px;
          padding: 8px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 10px 25px -5px rgba(0,0,0,0.6);
          font-size: 12.5px;
          font-weight: 500;
          pointer-events: auto;
          z-index: 2147483645;
          user-select: none;
        }

        .bt-region-cancel-btn {
          background: rgba(239, 68, 68, 0.15);
          color: #fca5a5;
          border: 1px solid rgba(239, 68, 68, 0.4);
          padding: 3px 10px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-family: inherit;
        }

        .bt-region-cancel-btn:hover {
          background: rgba(239, 68, 68, 0.3);
          color: #ffffff;
        }

        /* 3. Note Markers on Page */
        .bt-markers-layer {
          position: fixed;
          top: 0;
          left: 0;
          width: 0;
          height: 0;
          pointer-events: none;
          z-index: 2147483638;
        }

        .bt-note-marker {
          position: fixed;
          pointer-events: auto;
          background: linear-gradient(135deg, #2563eb, #1d4ed8);
          color: #ffffff;
          border: 2px solid #ffffff;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(37,99,235,0.4);
          border-radius: 999px;
          height: 26px;
          min-width: 26px;
          padding: 0 7px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          cursor: pointer;
          font-size: 11px;
          font-weight: 700;
          user-select: none;
          transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease;
          animation: bt-pop-in 0.2s ease-out;
          box-sizing: border-box;
          z-index: 2147483641;
        }

        @keyframes bt-pop-in {
          0% { transform: scale(0.6); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }

        .bt-note-marker:hover {
          transform: scale(1.15) translateY(-2px);
          box-shadow: 0 8px 20px rgba(37,99,235,0.6), 0 0 0 2px #60a5fa;
        }

        .bt-marker-resolved {
          background: linear-gradient(135deg, #475569, #334155);
          border-color: #94a3b8;
          opacity: 0.75;
        }

        .bt-region-marker-box {
          position: fixed;
          border: 2px dashed #0284c7;
          background: rgba(14, 165, 233, 0.08);
          pointer-events: none;
          box-sizing: border-box;
          border-radius: 6px;
          z-index: 2147483639;
        }

        .bt-page-notes-dock {
          position: fixed;
          top: 16px;
          right: 16px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          pointer-events: none;
          z-index: 2147483641;
        }

        .bt-page-note-pill {
          background: #0f172a;
          color: #c084fc;
          border: 1px solid #7e22ce;
          border-radius: 20px;
          padding: 5px 12px;
          font-size: 11.5px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
          cursor: pointer;
          pointer-events: auto;
          transition: all 0.15s ease;
        }

        .bt-page-note-pill:hover {
          background: #1e1b4b;
          transform: translateY(-1px);
        }

        /* 4. Floating Quick Toolbar */
        .bt-toolbar {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 30px;
          padding: 4px 6px;
          display: flex;
          align-items: center;
          gap: 4px;
          box-shadow: 0 10px 25px -3px rgba(0,0,0,0.6), 0 4px 6px -4px rgba(0,0,0,0.4);
          pointer-events: auto;
          z-index: 2147483646;
          user-select: none;
          transition: all 0.2s ease;
        }

        .bt-toolbar-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 12px;
          font-weight: 500;
          padding: 6px 12px;
          border-radius: 20px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.15s ease;
          font-family: inherit;
        }

        .bt-toolbar-btn:hover {
          background: #1e293b;
          color: #f8fafc;
        }

        .bt-toolbar-btn.active {
          background: #2563eb;
          color: #ffffff;
          font-weight: 600;
          box-shadow: 0 2px 6px rgba(37, 99, 235, 0.35);
        }

        .bt-count-pill {
          background: rgba(255, 255, 255, 0.2);
          color: #ffffff;
          font-size: 10px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 10px;
          line-height: 1.2;
        }

        .bt-toolbar-divider {
          width: 1px;
          height: 16px;
          background: #334155;
          margin: 0 2px;
        }

        /* 5. Modals & Popover Card */
        .bt-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(15, 23, 42, 0.75);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
          z-index: 2147483647;
          opacity: 1;
          box-sizing: border-box;
          animation: bt-fade-in 0.15s ease-out;
        }

        @keyframes bt-fade-in {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }

        .bt-modal {
          background: #0f172a;
          color: #f8fafc;
          border: 1px solid #334155;
          border-radius: 14px;
          padding: 20px;
          width: 450px;
          max-width: 92vw;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05);
          display: flex;
          flex-direction: column;
          gap: 14px;
          box-sizing: border-box;
        }

        .bt-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .bt-modal-title {
          font-size: 14.5px;
          font-weight: 600;
          letter-spacing: -0.01em;
          display: flex;
          align-items: center;
          gap: 8px;
          color: #f8fafc;
        }

        .bt-mode-badge {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          padding: 2px 7px;
          border-radius: 6px;
        }

        .bt-badge-element {
          background: rgba(59, 130, 246, 0.15);
          color: #60a5fa;
          border: 1px solid rgba(59, 130, 246, 0.4);
        }

        .bt-badge-region {
          background: rgba(14, 165, 233, 0.15);
          color: #38bdf8;
          border: 1px solid rgba(14, 165, 233, 0.4);
        }

        .bt-badge-page {
          background: rgba(168, 85, 247, 0.15);
          color: #c084fc;
          border: 1px solid rgba(168, 85, 247, 0.4);
        }

        .bt-badge-status-open {
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.4);
        }

        .bt-badge-status-resolved {
          background: rgba(100, 116, 139, 0.2);
          color: #94a3b8;
          border: 1px solid rgba(100, 116, 139, 0.4);
        }

        .bt-close-btn {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 15px;
          cursor: pointer;
          padding: 3px 7px;
          border-radius: 6px;
          transition: all 0.12s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .bt-close-btn:hover {
          background: #1e293b;
          color: #ffffff;
        }

        .bt-target-pill {
          background: #090d16;
          color: #94a3b8;
          border: 1px solid #1e293b;
          border-radius: 8px;
          padding: 8px 12px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11.5px;
          display: flex;
          align-items: center;
          gap: 8px;
          overflow: hidden;
        }

        .bt-pill-content {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #cbd5e1;
        }

        .bt-note-message-box {
          background: #090d16;
          border: 1px solid #1e293b;
          border-radius: 8px;
          padding: 12px 14px;
          font-size: 13.5px;
          line-height: 1.5;
          color: #f1f5f9;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 180px;
          overflow-y: auto;
        }

        .bt-textarea {
          background: #090d16;
          color: #f8fafc;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 12px;
          font-size: 13.5px;
          line-height: 1.5;
          resize: vertical;
          min-height: 95px;
          outline: none;
          box-sizing: border-box;
          width: 100%;
          font-family: inherit;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .bt-textarea::placeholder {
          color: #64748b;
        }

        .bt-textarea:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.25);
        }

        .bt-modal-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-top: 2px;
        }

        .bt-kbd-hint {
          font-size: 11px;
          color: #64748b;
          display: flex;
          align-items: center;
          gap: 4px;
          user-select: none;
        }

        .bt-kbd-hint kbd {
          background: #1e293b;
          color: #94a3b8;
          border: 1px solid #334155;
          border-radius: 4px;
          padding: 1px 5px;
          font-family: inherit;
          font-size: 10px;
          font-weight: 600;
        }

        .bt-modal-actions {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 8px;
        }

        .bt-btn {
          padding: 8px 16px;
          border-radius: 7px;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.15s ease;
          font-family: inherit;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .bt-btn-cancel {
          background: transparent;
          color: #94a3b8;
        }
        .bt-btn-cancel:hover {
          background: #1e293b;
          color: #f8fafc;
        }

        .bt-btn-save {
          background: #2563eb;
          color: #ffffff;
          box-shadow: 0 2px 6px rgba(37, 99, 235, 0.35);
        }
        .bt-btn-save:hover {
          background: #1d4ed8;
          box-shadow: 0 4px 10px rgba(37, 99, 235, 0.45);
        }

        .bt-btn-resolve {
          background: rgba(16, 185, 129, 0.15);
          color: #6ee7b7;
          border: 1px solid rgba(16, 185, 129, 0.35);
        }
        .bt-btn-resolve:hover {
          background: rgba(16, 185, 129, 0.3);
          color: #ffffff;
        }

        .bt-btn-delete {
          background: rgba(239, 68, 68, 0.15);
          color: #fca5a5;
          border: 1px solid rgba(239, 68, 68, 0.35);
        }
        .bt-btn-delete:hover {
          background: rgba(239, 68, 68, 0.3);
          color: #ffffff;
        }
      `;

      this.shadowRoot.appendChild(style);

      // Element Highlight Overlay
      this.highlightOverlay = document.createElement('div');
      this.highlightOverlay.className = 'bt-highlight';
      this.highlightOverlay.style.display = 'none';
      this.shadowRoot.appendChild(this.highlightOverlay);

      // Markers container layer
      this.markersContainer = document.createElement('div');
      this.markersContainer.className = 'bt-markers-layer';
      this.shadowRoot.appendChild(this.markersContainer);

      // Floating Toolbar
      if (this.options.showToolbar) {
        this.createToolbar();
      }
    }

    if (this.container && !this.container.isConnected) {
      const mountParent = document.body || document.documentElement;
      if (mountParent) {
        mountParent.appendChild(this.container);
      }
    }

    return this.shadowRoot;
  }

  private createToolbar(): void {
    if (!this.shadowRoot || this.toolbarElement) return;

    this.toolbarElement = document.createElement('div');
    this.toolbarElement.className = 'bt-toolbar';
    this.toolbarElement.innerHTML = `
      <button class="bt-toolbar-btn" id="bt-mode-element" title="Inspect element (or hold Alt+Click)">
        <span>🎯</span> Element
      </button>
      <button class="bt-toolbar-btn" id="bt-mode-region" title="Drag to select screen region">
        <span>📐</span> Region
      </button>
      <button class="bt-toolbar-btn" id="bt-mode-page" title="Leave full-page note">
        <span>📄</span> Page
      </button>
      <div class="bt-toolbar-divider"></div>
      <button class="bt-toolbar-btn active" id="bt-toggle-notes" title="Toggle visible note markers on screen">
        <span>📌</span> Notes <span class="bt-count-pill" id="bt-notes-count">0</span>
      </button>
    `;

    const btnElement = this.toolbarElement.querySelector('#bt-mode-element') as HTMLButtonElement;
    const btnRegion = this.toolbarElement.querySelector('#bt-mode-region') as HTMLButtonElement;
    const btnPage = this.toolbarElement.querySelector('#bt-mode-page') as HTMLButtonElement;
    const btnToggleNotes = this.toolbarElement.querySelector('#bt-toggle-notes') as HTMLButtonElement;

    btnElement.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      this.setMode(this.activeMode === 'element' ? 'idle' : 'element');
    };

    btnRegion.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      this.setMode(this.activeMode === 'region' ? 'idle' : 'region');
    };

    btnPage.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      this.setMode('page');
    };

    btnToggleNotes.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      this.showMarkers = !this.showMarkers;
      btnToggleNotes.classList.toggle('active', this.showMarkers);
      this.renderMarkers();
    };

    this.shadowRoot.appendChild(this.toolbarElement);
  }

  private updateToolbarState(): void {
    if (!this.toolbarElement) return;

    const btnElement = this.toolbarElement.querySelector('#bt-mode-element');
    const btnRegion = this.toolbarElement.querySelector('#bt-mode-region');
    const btnPage = this.toolbarElement.querySelector('#bt-mode-page');

    btnElement?.classList.toggle('active', this.activeMode === 'element');
    btnRegion?.classList.toggle('active', this.activeMode === 'region');
    btnPage?.classList.toggle('active', this.activeMode === 'page');
  }

  private updateToolbarCount(): void {
    if (!this.toolbarElement) return;
    const countEl = this.toolbarElement.querySelector('#bt-notes-count');
    if (countEl) {
      const openCount = this.savedNotes.filter((n) => n.status === 'OPEN').length;
      countEl.textContent = String(openCount);
    }
  }

  public renderMarkers(): void {
    const root = this.ensureContainer();
    if (!root || !this.markersContainer) return;

    this.markersContainer.innerHTML = '';
    if (!this.showMarkers) return;

    const currentPath = window.location.pathname;
    // Filter open notes on this route or global
    const activeNotes = this.savedNotes.filter(
      (n) => n.status === 'OPEN' && (n.route === currentPath || !n.route || n.route === '/' || window.location.href.includes(n.route))
    );

    const pageNotes: VisualNote[] = [];

    activeNotes.forEach((note, index) => {
      if (note.type === 'page') {
        pageNotes.push(note);
        return;
      }

      if (note.type === 'region' && note.region) {
        // Region box
        const regBox = document.createElement('div');
        regBox.className = 'bt-region-marker-box';
        regBox.style.left = `${note.region.x}px`;
        regBox.style.top = `${note.region.y}px`;
        regBox.style.width = `${note.region.width}px`;
        regBox.style.height = `${note.region.height}px`;
        this.markersContainer!.appendChild(regBox);

        // Pin on top-left of region
        const pin = document.createElement('div');
        pin.className = 'bt-note-marker';
        pin.style.left = `${Math.max(4, note.region.x - 12)}px`;
        pin.style.top = `${Math.max(4, note.region.y - 12)}px`;
        pin.title = note.message;
        pin.innerHTML = `<span>📐</span> <span>#${index + 1}</span>`;
        pin.onclick = (e) => {
          e.stopPropagation();
          this.openNoteCard(note);
        };
        this.markersContainer!.appendChild(pin);
        return;
      }

      // Element note
      let targetEl: HTMLElement | null = null;
      if (note.target?.selector) {
        try {
          targetEl = document.querySelector(note.target.selector) as HTMLElement | null;
        } catch {}
      }

      const rect = targetEl ? targetEl.getBoundingClientRect() : note.target?.boundingRect;
      if (rect) {
        const pin = document.createElement('div');
        pin.className = 'bt-note-marker';
        pin.setAttribute('data-note-id', note.id);
        pin.title = note.message;
        pin.style.left = `${Math.max(4, rect.left - 10)}px`;
        pin.style.top = `${Math.max(4, rect.top - 12)}px`;
        pin.innerHTML = `<span>📝</span> <span>#${index + 1}</span>`;

        pin.onclick = (e) => {
          e.stopPropagation();
          this.openNoteCard(note);
        };

        if (targetEl) {
          pin.onmouseenter = () => this.updateHighlight(targetEl!);
          pin.onmouseleave = () => this.hideHighlight();
        }

        this.markersContainer!.appendChild(pin);
      }
    });

    // Page notes docked in top-right
    if (pageNotes.length > 0) {
      const pageDock = document.createElement('div');
      pageDock.className = 'bt-page-notes-dock';
      pageNotes.forEach((pNote, idx) => {
        const pill = document.createElement('div');
        pill.className = 'bt-page-note-pill';
        pill.innerHTML = `<span>📄</span> <span>Page Note (${truncate(pNote.message, 25)})</span>`;
        pill.onclick = (e) => {
          e.stopPropagation();
          this.openNoteCard(pNote);
        };
        pageDock.appendChild(pill);
      });
      this.markersContainer.appendChild(pageDock);
    }
  }

  private updateMarkerPositions(): void {
    if (!this.showMarkers || !this.markersContainer) return;
    this.renderMarkers();
  }

  public openNoteCard(note: VisualNote): void {
    const root = this.ensureContainer();
    if (!root) return;

    if (this.cardOverlay && this.cardOverlay.parentElement) {
      this.cardOverlay.parentElement.removeChild(this.cardOverlay);
      this.cardOverlay = null;
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'bt-modal-backdrop';
    this.cardOverlay = backdrop;

    const badgeClass = `bt-badge-${note.type.toLowerCase()}`;
    const statusClass = note.status === 'OPEN' ? 'bt-badge-status-open' : 'bt-badge-status-resolved';
    const icon = note.type === 'region' ? '📐' : note.type === 'page' ? '📄' : '🎯';
    const contextText =
      note.type === 'region' && note.region
        ? `Region: ${note.region.width} × ${note.region.height} px · Route: ${note.route}`
        : note.type === 'page'
        ? `Page Note · Route: ${note.route}`
        : `${note.target?.selector || 'Element'} (${note.target?.boundingRect?.width || 0}×${note.target?.boundingRect?.height || 0}px) · ${note.route}`;

    const formattedDate = new Date(note.createdAt).toLocaleString();

    backdrop.innerHTML = `
      <div class="bt-modal">
        <div class="bt-modal-header">
          <div class="bt-modal-title">
            <span>${icon} Visual Note Details</span>
            <span class="bt-mode-badge ${badgeClass}">${note.type.toUpperCase()}</span>
            <span class="bt-mode-badge ${statusClass}">${note.status}</span>
          </div>
          <button class="bt-close-btn" id="btn-card-close" title="Close (Esc)">✕</button>
        </div>

        <div class="bt-target-pill" title="${contextText}">
          <span>🏷️</span>
          <span class="bt-pill-content">${contextText}</span>
        </div>

        <div class="bt-note-message-box">${note.message}</div>

        <div style="font-size: 11px; color: #64748b; display: flex; justify-content: space-between; padding: 0 2px;">
          <span>Created: ${formattedDate}</span>
          <span>ID: <code style="font-family: monospace; color: #94a3b8;">${note.id}</code></span>
        </div>

        <div class="bt-modal-footer">
          <button class="bt-btn bt-btn-delete" id="btn-card-delete" title="Delete this note">
            <span>🗑️</span> Delete
          </button>
          <div class="bt-modal-actions">
            <button class="bt-btn bt-btn-cancel" id="btn-card-dismiss">Close</button>
            <button class="bt-btn ${note.status === 'OPEN' ? 'bt-btn-resolve' : 'bt-btn-save'}" id="btn-card-resolve">
              ${note.status === 'OPEN' ? '<span>✅</span> Resolve Note' : '<span>↺</span> Reopen'}
            </button>
          </div>
        </div>
      </div>
    `;

    const btnClose = backdrop.querySelector('#btn-card-close') as HTMLButtonElement;
    const btnDismiss = backdrop.querySelector('#btn-card-dismiss') as HTMLButtonElement;
    const btnResolve = backdrop.querySelector('#btn-card-resolve') as HTMLButtonElement;
    const btnDelete = backdrop.querySelector('#btn-card-delete') as HTMLButtonElement;

    const closeCard = () => {
      if (this.cardOverlay) {
        root.removeChild(this.cardOverlay);
        this.cardOverlay = null;
        this.hideHighlight();
      }
    };

    btnClose.onclick = closeCard;
    btnDismiss.onclick = closeCard;
    backdrop.onclick = (e) => {
      if (e.target === backdrop) closeCard();
    };

    btnResolve.onclick = () => {
      if (note.status === 'OPEN') {
        this.transport.send({ type: 'resolve_note', noteId: note.id });
      } else {
        this.transport.send({ type: 'reopen_note', noteId: note.id });
      }
      closeCard();
    };

    btnDelete.onclick = () => {
      this.transport.send({ type: 'delete_note', noteId: note.id });
      closeCard();
    };

    root.appendChild(backdrop);
  }

  private setupListeners(): void {
    // 1. Mouse move: hover highlight in element mode or with Alt key
    const onMouseMove = (e: MouseEvent) => {
      if (this.modalOverlay || this.cardOverlay || this.isDraggingRegion || this.activeMode === 'region') return;

      // Don't highlight elements if mouse is over our own inspector UI
      const path = e.composedPath ? e.composedPath() : [];
      if (this.container && path.includes(this.container)) {
        this.hideHighlight();
        return;
      }

      if (e.altKey || this.activeMode === 'element') {
        const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        if (target && target !== this.container && !this.container?.contains(target)) {
          this.hoveredElement = target;
          this.updateHighlight(target);
          return;
        }
      }

      if (!e.altKey && this.activeMode !== 'element') {
        this.hideHighlight();
      }
    };

    // 2. Click: Alt+Click or Element mode click selects element and opens editor
    const onClick = (e: MouseEvent) => {
      if (this.modalOverlay || this.cardOverlay) return;

      // If clicking inside inspector toolbar or container, do NOT intercept
      const path = e.composedPath ? e.composedPath() : [];
      if (this.container && path.includes(this.container)) {
        return;
      }

      if (this.activeMode === 'region') return;

      if (e.altKey || this.activeMode === 'element') {
        e.preventDefault();
        e.stopPropagation();

        const target = (this.hoveredElement || document.elementFromPoint(e.clientX, e.clientY)) as HTMLElement | null;
        if (target && target !== this.container && !this.container?.contains(target)) {
          this.selectedElement = target;
          this.openNoteEditor(target, 'element');
          if (this.activeMode === 'element') {
            this.setMode('idle');
          }
        }
      }
    };

    // 3. Key handling: Escape cancels active modes, Alt release hides highlight
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (this.cardOverlay && this.cardOverlay.parentElement && this.shadowRoot) {
          this.shadowRoot.removeChild(this.cardOverlay);
          this.cardOverlay = null;
        } else if (this.activeMode === 'region' || this.activeMode === 'element') {
          this.setMode('idle');
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && !this.modalOverlay && !this.cardOverlay && this.activeMode !== 'element') {
        this.hideHighlight();
      }
    };

    // 4. Scroll & resize: reposition markers accurately
    const onScrollOrResize = () => {
      requestAnimationFrame(() => {
        this.updateMarkerPositions();
      });
    };

    window.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
    window.addEventListener('click', onClick, { capture: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('scroll', onScrollOrResize, { capture: true, passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });

    this.cleanups.push(() => {
      window.removeEventListener('mousemove', onMouseMove, { capture: true });
      window.removeEventListener('click', onClick, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('scroll', onScrollOrResize, { capture: true });
      window.removeEventListener('resize', onScrollOrResize);
    });
  }

  private showRegionOverlay(): void {
    const root = this.ensureContainer();
    if (!root) return;

    if (!this.regionOverlay) {
      this.regionOverlay = document.createElement('div');
      this.regionOverlay.className = 'bt-region-overlay';

      this.regionBox = document.createElement('div');
      this.regionBox.className = 'bt-region-box';
      this.regionBox.style.display = 'none';
      this.regionOverlay.appendChild(this.regionBox);

      // Top helper & cancel banner
      this.regionBanner = document.createElement('div');
      this.regionBanner.className = 'bt-region-banner';
      this.regionBanner.innerHTML = `
        <span>📐 Drag rectangle on screen to select region</span>
        <button class="bt-region-cancel-btn" id="bt-region-cancel">✕ Cancel (Esc)</button>
      `;

      const btnCancel = this.regionBanner.querySelector('#bt-region-cancel') as HTMLButtonElement;
      btnCancel.onclick = (e: MouseEvent) => {
        e.stopPropagation();
        this.setMode('idle');
      };

      this.regionOverlay.appendChild(this.regionBanner);

      // Right-click cancels region mode
      this.regionOverlay.oncontextmenu = (e: MouseEvent) => {
        e.preventDefault();
        this.setMode('idle');
      };

      // Drag events
      this.regionOverlay.onmousedown = (e: MouseEvent) => {
        const path = e.composedPath ? e.composedPath() : [];
        if (this.regionBanner && path.includes(this.regionBanner)) return;
        if (this.toolbarElement && path.includes(this.toolbarElement)) return;

        this.isDraggingRegion = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        if (this.regionBox) {
          this.regionBox.style.display = 'block';
          this.regionBox.style.left = `${e.clientX}px`;
          this.regionBox.style.top = `${e.clientY}px`;
          this.regionBox.style.width = '0px';
          this.regionBox.style.height = '0px';
        }
      };

      this.regionOverlay.onmousemove = (e: MouseEvent) => {
        if (!this.isDraggingRegion || !this.regionBox) return;

        const currentX = e.clientX;
        const currentY = e.clientY;

        const left = Math.min(this.dragStartX, currentX);
        const top = Math.min(this.dragStartY, currentY);
        const width = Math.abs(currentX - this.dragStartX);
        const height = Math.abs(currentY - this.dragStartY);

        this.regionBox.style.left = `${left}px`;
        this.regionBox.style.top = `${top}px`;
        this.regionBox.style.width = `${width}px`;
        this.regionBox.style.height = `${height}px`;

        let badge = this.regionBox.querySelector('.bt-region-badge') as HTMLDivElement | null;
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'bt-region-badge';
          this.regionBox.appendChild(badge);
        }
        badge.textContent = `Region: ${Math.round(width)} × ${Math.round(height)} px`;
      };

      this.regionOverlay.onmouseup = (e: MouseEvent) => {
        if (!this.isDraggingRegion) return;
        this.isDraggingRegion = false;

        const currentX = e.clientX;
        const currentY = e.clientY;
        const left = Math.min(this.dragStartX, currentX);
        const top = Math.min(this.dragStartY, currentY);
        const width = Math.abs(currentX - this.dragStartX);
        const height = Math.abs(currentY - this.dragStartY);

        if (width > 15 && height > 15) {
          this.selectedRegion = {
            x: Math.round(left),
            y: Math.round(top),
            width: Math.round(width),
            height: Math.round(height),
          };
          this.hideRegionOverlay();
          this.setMode('idle');
          this.openRegionNoteEditor(this.selectedRegion);
        } else {
          this.hideRegionOverlay();
          this.setMode('idle');
        }
      };
    }

    // Always ensure regionOverlay is mounted before toolbar so toolbar is interactable
    if (this.toolbarElement && this.toolbarElement.parentNode === root) {
      root.insertBefore(this.regionOverlay, this.toolbarElement);
    } else {
      root.appendChild(this.regionOverlay);
    }
  }

  private hideRegionOverlay(): void {
    this.isDraggingRegion = false;
    if (this.regionOverlay && this.regionOverlay.parentNode) {
      this.regionOverlay.parentNode.removeChild(this.regionOverlay);
    }
    if (this.regionBox) {
      this.regionBox.style.display = 'none';
    }
  }

  private updateHighlight(el: HTMLElement): void {
    const root = this.ensureContainer();
    if (!root || !this.highlightOverlay) return;

    const rect = el.getBoundingClientRect();
    this.highlightOverlay.style.display = 'block';
    this.highlightOverlay.style.top = `${rect.top}px`;
    this.highlightOverlay.style.left = `${rect.left}px`;
    this.highlightOverlay.style.width = `${rect.width}px`;
    this.highlightOverlay.style.height = `${rect.height}px`;

    const selector = getSemanticSelector(el);
    const badgeText = `${selector} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;

    let badge = this.highlightOverlay.querySelector('.bt-badge') as HTMLDivElement | null;
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'bt-badge';
      this.highlightOverlay.appendChild(badge);
    }
    badge.textContent = badgeText;
  }

  private hideHighlight(): void {
    if (this.highlightOverlay) {
      this.highlightOverlay.style.display = 'none';
    }
  }

  public openNoteEditor(el?: HTMLElement, noteType: 'element' | 'page' = 'element'): void {
    const root = this.ensureContainer();
    if (!root) return;

    const targetEl = el || document.body;
    this.selectedElement = targetEl;
    if (noteType === 'element') {
      this.updateHighlight(targetEl);
    }

    this.renderNoteModal({
      title: 'Add Visual Note',
      modeBadge: noteType.toUpperCase(),
      pillText:
        noteType === 'page'
          ? `Page Viewport: ${window.innerWidth} × ${window.innerHeight} px`
          : `${getSemanticSelector(targetEl)} (${Math.round(targetEl.getBoundingClientRect().width)}×${Math.round(targetEl.getBoundingClientRect().height)}) · Viewport: ${window.innerWidth}×${window.innerHeight}`,
      onSave: async (message) => {
        await this.saveVisualNote(targetEl, message, noteType);
      },
    });
  }

  public openRegionNoteEditor(region: RegionContext): void {
    this.renderNoteModal({
      title: 'Add Region Note',
      modeBadge: 'REGION',
      pillText: `Selected Area: x:${region.x}, y:${region.y} (${region.width} × ${region.height} px)`,
      onSave: async (message) => {
        await this.saveRegionVisualNote(region, message);
      },
    });
  }

  private renderNoteModal(options: {
    title: string;
    modeBadge: string;
    pillText: string;
    onSave: (message: string) => Promise<void>;
  }): void {
    const root = this.ensureContainer();
    if (!root) return;

    // Remove existing modal if any
    if (this.modalOverlay && this.modalOverlay.parentElement) {
      this.modalOverlay.parentElement.removeChild(this.modalOverlay);
      this.modalOverlay = null;
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'bt-modal-backdrop';
    this.modalOverlay = backdrop;

    const badgeClass = `bt-badge-${options.modeBadge.toLowerCase()}`;
    const icon = options.modeBadge === 'REGION' ? '📐' : options.modeBadge === 'PAGE' ? '📄' : '🎯';
    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

    backdrop.innerHTML = `
      <div class="bt-modal">
        <div class="bt-modal-header">
          <div class="bt-modal-title">
            <span>📝 ${options.title}</span>
            <span class="bt-mode-badge ${badgeClass}">${options.modeBadge}</span>
          </div>
          <button class="bt-close-btn" id="btn-close" title="Close (Esc)">✕</button>
        </div>
        <div class="bt-target-pill" title="${options.pillText}">
          <span>${icon}</span>
          <span class="bt-pill-content">${options.pillText}</span>
        </div>
        <textarea class="bt-textarea" placeholder="Describe the layout issue, styling bug, or note for AI agent..." autofocus></textarea>
        <div class="bt-modal-footer">
          <div class="bt-kbd-hint">
            <kbd>${isMac ? '⌘' : 'Ctrl'}+Enter</kbd> save · <kbd>Esc</kbd> cancel
          </div>
          <div class="bt-modal-actions">
            <button class="bt-btn bt-btn-cancel" id="btn-cancel">Cancel</button>
            <button class="bt-btn bt-btn-save" id="btn-save">Save Note</button>
          </div>
        </div>
      </div>
    `;

    const textarea = backdrop.querySelector('textarea') as HTMLTextAreaElement;
    const btnClose = backdrop.querySelector('#btn-close') as HTMLButtonElement;
    const btnCancel = backdrop.querySelector('#btn-cancel') as HTMLButtonElement;
    const btnSave = backdrop.querySelector('#btn-save') as HTMLButtonElement;

    const closeModal = () => {
      if (this.modalOverlay) {
        root.removeChild(this.modalOverlay);
        this.modalOverlay = null;
        this.hideHighlight();
        this.hideRegionOverlay();
      }
    };

    btnClose.onclick = closeModal;
    btnCancel.onclick = closeModal;

    backdrop.onclick = (e: MouseEvent) => {
      if (e.target === backdrop) {
        closeModal();
      }
    };

    const submitNote = async () => {
      const message = textarea.value.trim();
      if (!message) return;

      btnSave.textContent = 'Saving...';
      btnSave.disabled = true;

      try {
        await options.onSave(message);
      } finally {
        closeModal();
      }
    };

    btnSave.onclick = submitNote;

    textarea.onkeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
        e.preventDefault();
        submitNote();
      }
      if (e.key === 'Escape') {
        closeModal();
      }
    };

    root.appendChild(backdrop);
    setTimeout(() => textarea?.focus(), 50);
  }

  public async saveVisualNote(targetEl: HTMLElement, message: string, noteType: 'element' | 'page' = 'element'): Promise<void> {
    const rect = targetEl.getBoundingClientRect();
    const selector = noteType === 'page' ? 'body' : getSemanticSelector(targetEl);

    // 1. Capture screenshot via screenshotDriver
    let screenshotDataUrl: string | undefined;
    try {
      const snap = await this.screenshotDriver.captureElement(targetEl);
      if (snap.ok) {
        screenshotDataUrl = snap.dataUrl;
      }
    } catch {
      // Defensive
    }

    // 2. Extract DOM Context
    const elementContext = this.extractElementContext(targetEl);

    // 3. Extract Target
    const target: NoteTarget = {
      selector,
      boundingRect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        bottom: Math.round(rect.bottom),
        right: Math.round(rect.right),
      },
      visible: rect.width > 0 && rect.height > 0,
      confidence: selector.startsWith('[data-test') ? 'high' : selector.startsWith('#') ? 'medium' : 'low',
    };

    const notePayload = {
      type: 'create_note',
      sessionId: this.transport.getSessionId() || '',
      noteType,
      message,
      route: window.location.pathname + window.location.search,
      url: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
      scroll: {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      target,
      elementContext,
      screenshot: screenshotDataUrl,
      timestamp: Date.now(),
    };

    this.transport.send(notePayload);
    if (this.options.onNoteCreated) {
      this.options.onNoteCreated(notePayload as any);
    }
  }

  public async saveRegionVisualNote(region: RegionContext, message: string): Promise<void> {
    // 1. Capture full page screenshot and crop to region
    let screenshotDataUrl: string | undefined;
    try {
      const snap = await this.screenshotDriver.captureElement(document.body || document.documentElement);
      if (snap.ok && snap.dataUrl) {
        screenshotDataUrl = await this.cropDataUrl(snap.dataUrl, region);
      }
    } catch {
      // Defensive
    }

    const notePayload = {
      type: 'create_note',
      sessionId: this.transport.getSessionId() || '',
      noteType: 'region',
      message,
      route: window.location.pathname + window.location.search,
      url: window.location.href,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
      scroll: {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      region,
      screenshot: screenshotDataUrl,
      timestamp: Date.now(),
    };

    this.transport.send(notePayload);
    if (this.options.onNoteCreated) {
      this.options.onNoteCreated(notePayload as any);
    }
  }

  private async cropDataUrl(dataUrl: string, region: RegionContext): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = region.width;
          canvas.height = region.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(dataUrl);
            return;
          }

          const dpr = window.devicePixelRatio || 1;
          ctx.drawImage(
            img,
            region.x * dpr,
            region.y * dpr,
            region.width * dpr,
            region.height * dpr,
            0,
            0,
            region.width,
            region.height
          );
          resolve(canvas.toDataURL('image/webp', 0.9));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  private extractElementContext(el: HTMLElement): ElementContext {
    const selector = getSemanticSelector(el);
    const tag = el.tagName.toLowerCase();

    // Attributes (sanitize passwords/tokens)
    const attributes: Record<string, string> = {};
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      if (attr.name === 'value' && (el as HTMLInputElement).type === 'password') {
        attributes[attr.name] = '[REDACTED]';
      } else {
        attributes[attr.name] = attr.value;
      }
    }

    // Clone element to sanitize inner sensitive fields
    let outerHTML = '';
    try {
      const clone = el.cloneNode(true) as HTMLElement;
      for (const passInput of Array.from(clone.querySelectorAll('input[type="password"]'))) {
        passInput.setAttribute('value', '[REDACTED]');
      }
      outerHTML = truncate(clone.outerHTML, 10240); // 10 KB max
    } catch {
      outerHTML = truncate(el.outerHTML, 10240);
    }

    let parent: { selector: string; tag: string } | undefined;
    if (el.parentElement && el.parentElement !== document.body) {
      parent = {
        selector: getSemanticSelector(el.parentElement),
        tag: el.parentElement.tagName.toLowerCase(),
      };
    }

    return {
      selector,
      tag,
      attributes,
      outerHTML,
      innerText: truncate(el.textContent?.trim(), 200),
      parent,
    };
  }

  public destroy(): void {
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch {}
    }
    this.cleanups = [];

    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    this.shadowRoot = null;
    this.toolbarElement = null;
    this.regionOverlay = null;
    this.regionBox = null;
    this.regionBanner = null;
    this.markersContainer = null;
    this.modalOverlay = null;
    this.cardOverlay = null;
  }
}
