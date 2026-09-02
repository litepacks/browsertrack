import type { ElementContext, NoteTarget, RegionContext, VisualNote } from '../../../core/src/index.js';
import { getSemanticSelector, truncate } from '../../../core/src/index.js';
import type { ScreenshotDriver } from '../screenshot/driver.js';
import type { WebSocketTransport } from '../transport/websocket.js';
import { shouldHideUIFromUrl } from '../config.js';
import { resolveComponentSource } from '../source/resolver.js';

export type NoteInspectMode = 'element' | 'region' | 'page' | 'idle';

export interface InspectorOptions {
  shortcut?: string; // e.g. "Alt+Click"
  maskSelectors?: string[];
  showToolbar?: boolean;
  showBadges?: boolean;
  hidden?: boolean;
  hideQueryParam?: string | string[];
  onNoteCreated?: (note: Partial<VisualNote>) => void;
}

export interface ActiveScenarioState {
  id: string;
  title: string;
  stepNumber: number;
}

/**
 * Isolated Visual Note & Multi-Step Scenario Inspector rendering in Shadow DOM.
 * Supports:
 * 1. Element selection (hover highlight & click)
 * 2. Region / Area selection (drag-and-drop rectangle on screen with cancel banner)
 * 3. Whole page note
 * 4. Multi-Step Flow / Scenario Recording (sequential 'Save & Next Step' continuous capture)
 * 5. Real-time Saved Note & Step Markers (pins with step sequencing numbers)
 * 6. Interactive Note & Step Detail Card (with previous/next step walk-through navigation)
 * 7. Floating quick dock / toolbar in bottom-right corner with Notes count and Flow controls
 * 8. Automatic invisibility via query parameter (?bt=0, ?bt=false, ?bt=hidden, ?no_bt, custom query params)
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
  private toastContainer: HTMLDivElement | null = null;

  private activeMode: NoteInspectMode = 'idle';
  private activeScenario: ActiveScenarioState | null = null;
  private hoveredElement: HTMLElement | null = null;
  private selectedElement: HTMLElement | null = null;
  private selectedRegion: RegionContext | null = null;

  private isDraggingRegion = false;
  private dragStartX = 0;
  private dragStartY = 0;

  private savedNotes: VisualNote[] = [];
  private showMarkers = true;
  private isHidden = false;
  private cleanups: (() => void)[] = [];

  constructor(transport: WebSocketTransport, screenshotDriver: ScreenshotDriver, options: InspectorOptions = {}) {
    this.transport = transport;
    this.screenshotDriver = screenshotDriver;
    const hiddenByQuery = shouldHideUIFromUrl(options.hideQueryParam);
    this.isHidden = options.hidden === true || hiddenByQuery;
    this.showMarkers = options.showBadges !== false && !this.isHidden;
    this.options = {
      shortcut: 'Alt+Click',
      maskSelectors: ['input[type="password"]', '[data-sensitive]'],
      showToolbar: true,
      showBadges: true,
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

  public showToast(message: string, icon = '✨', durationMs = 2500): void {
    if (typeof document === 'undefined') return;
    const root = this.ensureContainer();
    if (!root || !this.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'bt-toast';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('bt-toast-fadeout');
      setTimeout(() => {
        if (toast.parentElement) {
          toast.parentElement.removeChild(toast);
        }
      }, 250);
    }, durationMs);
  }

  public startScenario(title?: string): void {
    const defaultTitle = title || `Scenario ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    this.activeScenario = {
      id: `scen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      title: defaultTitle,
      stepNumber: 1,
    };
    this.updateToolbarState();
    this.setMode('element');
    this.showToast(`Started flow: "${defaultTitle}"`, '🎬');
  }

  public finishScenario(): void {
    const title = this.activeScenario?.title;
    this.activeScenario = null;
    this.updateToolbarState();
    this.setMode('idle');
    this.showToast(title ? `Finished flow: "${title}"` : 'Flow recording finished', '✓');
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

  public isVisible(): boolean {
    return !this.isHidden;
  }

  public setVisible(visible: boolean): void {
    this.isHidden = !visible;
    this.showMarkers = this.options.showBadges !== false && !this.isHidden;

    if (this.container) {
      this.container.style.display = this.isHidden ? 'none' : 'block';
    }

    if (this.toolbarElement) {
      this.toolbarElement.style.display = this.isHidden ? 'none' : 'flex';
    } else if (!this.isHidden && this.options.showToolbar !== false) {
      this.createToolbar();
    }

    if (this.isHidden) {
      this.hideHighlight();
      this.hideRegionOverlay();
      if (this.modalOverlay && this.shadowRoot) {
        this.shadowRoot.removeChild(this.modalOverlay);
        this.modalOverlay = null;
      }
      if (this.cardOverlay && this.shadowRoot) {
        this.shadowRoot.removeChild(this.cardOverlay);
        this.cardOverlay = null;
      }
      if (this.markersContainer) {
        this.markersContainer.innerHTML = '';
      }
    } else {
      this.renderMarkers();
      this.updateToolbarCount();
    }
  }

  private ensureContainer(): ShadowRoot | null {
    if (typeof document === 'undefined') return null;

    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'browsertrack-inspector-host';
      this.container.style.cssText =
        'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';
      if (this.isHidden) {
        this.container.style.display = 'none';
      }

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

        .bt-note-marker-step {
          background: linear-gradient(135deg, #f59e0b, #d97706);
          border-color: #fef3c7;
          box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4), 0 0 0 1px rgba(217, 119, 6, 0.5);
        }

        @keyframes bt-pop-in {
          0% { transform: scale(0.6); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }

        .bt-note-marker:hover {
          transform: scale(1.15) translateY(-2px);
          box-shadow: 0 8px 20px rgba(37,99,235,0.6), 0 0 0 2px #60a5fa;
        }

        .bt-note-marker-step:hover {
          box-shadow: 0 8px 20px rgba(245, 158, 11, 0.7), 0 0 0 2px #fde68a;
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

        .bt-toolbar-btn.active-scenario {
          background: linear-gradient(135deg, #f59e0b, #d97706);
          color: #ffffff;
          font-weight: 700;
          box-shadow: 0 2px 8px rgba(245, 158, 11, 0.4);
          animation: bt-pulse 2s infinite;
        }

        @keyframes bt-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
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
          width: 470px;
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
          flex-wrap: wrap;
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

        .bt-badge-step {
          background: rgba(245, 158, 11, 0.15);
          color: #fbbf24;
          border: 1px solid rgba(245, 158, 11, 0.4);
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

        .bt-component-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(15, 23, 42, 0.95);
          border: 1px solid rgba(99, 102, 241, 0.35);
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 11.5px;
          color: #c7d2fe;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .bt-scenario-stepper {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #090d16;
          border: 1px solid #1e293b;
          border-radius: 8px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 600;
          color: #f59e0b;
        }

        .bt-step-nav-btn {
          background: #1e293b;
          color: #f8fafc;
          border: 1px solid #334155;
          padding: 4px 10px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 11px;
          font-weight: 600;
          transition: all 0.12s ease;
          font-family: inherit;
        }

        .bt-step-nav-btn:hover:not(:disabled) {
          background: #2563eb;
          border-color: #3b82f6;
          color: #ffffff;
        }

        .bt-step-nav-btn:disabled {
          opacity: 0.3;
          cursor: not-allowed;
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
          gap: 10px;
          margin-top: 2px;
          flex-wrap: wrap;
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
          flex-wrap: wrap;
        }

        .bt-btn {
          padding: 7px 14px;
          border-radius: 7px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.15s ease;
          font-family: inherit;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
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

        .bt-btn-next-step {
          background: linear-gradient(135deg, #6366f1, #4f46e5);
          color: #ffffff;
          box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
        }
        .bt-btn-next-step:hover {
          background: linear-gradient(135deg, #4f46e5, #4338ca);
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.55);
        }

        .bt-btn-finish-flow {
          background: linear-gradient(135deg, #10b981, #059669);
          color: #ffffff;
          box-shadow: 0 2px 8px rgba(16, 185, 129, 0.35);
        }
        .bt-btn-finish-flow:hover {
          background: linear-gradient(135deg, #059669, #047857);
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

        /* 6. Toast Notifications */
        .bt-toast-container {
          position: fixed;
          bottom: 74px;
          right: 24px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: none;
          z-index: 2147483647;
          align-items: flex-end;
        }

        .bt-toast {
          background: #0f172a;
          color: #f8fafc;
          border: 1px solid #334155;
          border-radius: 30px;
          padding: 8px 16px;
          font-size: 12.5px;
          font-weight: 500;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 10px 25px -3px rgba(0, 0, 0, 0.6), 0 4px 6px -4px rgba(0, 0, 0, 0.4);
          pointer-events: auto;
          animation: bt-toast-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          transition: opacity 0.25s ease, transform 0.25s ease;
          user-select: none;
        }

        .bt-toast-fadeout {
          opacity: 0;
          transform: translateY(6px);
        }

        @keyframes bt-toast-in {
          from { opacity: 0; transform: translateY(8px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
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

      // Toast container layer
      this.toastContainer = document.createElement('div');
      this.toastContainer.className = 'bt-toast-container';
      this.shadowRoot.appendChild(this.toastContainer);

      // Floating Toolbar
      if (this.options.showToolbar && !this.isHidden) {
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
      <button class="bt-toolbar-btn" id="bt-mode-flow" title="Record multi-step reproduction flow">
        <span>🎬</span> Flow
      </button>
      <div class="bt-toolbar-divider"></div>
      <button class="bt-toolbar-btn active" id="bt-toggle-notes" title="Toggle visible note markers on screen">
        <span>📌</span> Notes <span class="bt-count-pill" id="bt-notes-count">0</span>
      </button>
    `;

    const btnElement = this.toolbarElement.querySelector('#bt-mode-element') as HTMLButtonElement;
    const btnRegion = this.toolbarElement.querySelector('#bt-mode-region') as HTMLButtonElement;
    const btnPage = this.toolbarElement.querySelector('#bt-mode-page') as HTMLButtonElement;
    const btnFlow = this.toolbarElement.querySelector('#bt-mode-flow') as HTMLButtonElement;
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

    btnFlow.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      if (this.activeScenario) {
        this.finishScenario();
      } else {
        this.startScenario();
      }
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
    const btnFlow = this.toolbarElement.querySelector('#bt-mode-flow');

    btnElement?.classList.toggle('active', this.activeMode === 'element');
    btnRegion?.classList.toggle('active', this.activeMode === 'region');
    btnPage?.classList.toggle('active', this.activeMode === 'page');

    if (btnFlow) {
      if (this.activeScenario) {
        btnFlow.className = 'bt-toolbar-btn active-scenario';
        btnFlow.innerHTML = `<span>🎬</span> Step ${this.activeScenario.stepNumber} (Finish)`;
        btnFlow.setAttribute('title', `Click to finish recording "${this.activeScenario.title}"`);
      } else {
        btnFlow.className = 'bt-toolbar-btn';
        btnFlow.innerHTML = `<span>🎬</span> Flow`;
        btnFlow.setAttribute('title', 'Record multi-step reproduction flow');
      }
    }
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
    if (!this.showMarkers || this.isHidden) return;

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

      const isStep = !!note.scenarioId && note.stepNumber != null;
      const stepLabel = isStep ? `🎬 Step ${note.stepNumber}` : `#${index + 1}`;
      const markerClass = `bt-note-marker ${isStep ? 'bt-note-marker-step' : ''}`;

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
        pin.className = markerClass;
        pin.style.left = `${Math.max(4, note.region.x - 12)}px`;
        pin.style.top = `${Math.max(4, note.region.y - 12)}px`;
        pin.title = isStep ? `[${note.scenarioTitle || 'Scenario'}] Step ${note.stepNumber}: ${note.message}` : note.message;
        pin.innerHTML = `<span>${isStep ? '🎬' : '📐'}</span> <span>${stepLabel}</span>`;
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
        pin.className = markerClass;
        pin.setAttribute('data-note-id', note.id);
        pin.title = isStep ? `[${note.scenarioTitle || 'Scenario'}] Step ${note.stepNumber}: ${note.message}` : note.message;
        pin.style.left = `${Math.max(4, rect.left - 10)}px`;
        pin.style.top = `${Math.max(4, rect.top - 12)}px`;
        pin.innerHTML = `<span>${isStep ? '🎬' : '📝'}</span> <span>${stepLabel}</span>`;

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
      pageNotes.forEach((pNote) => {
        const pill = document.createElement('div');
        pill.className = 'bt-page-note-pill';
        const label = pNote.scenarioId && pNote.stepNumber ? `Step ${pNote.stepNumber}: ` : '';
        pill.innerHTML = `<span>📄</span> <span>${label}${truncate(pNote.message, 25)}</span>`;
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

    // Scenario flow steps navigation
    let scenarioStepsHtml = '';
    let scenarioSteps: VisualNote[] = [];
    if (note.scenarioId) {
      scenarioSteps = this.savedNotes
        .filter((n) => n.scenarioId === note.scenarioId)
        .sort((a, b) => (a.stepNumber || 0) - (b.stepNumber || 0));

      const currentIndex = scenarioSteps.findIndex((s) => s.id === note.id);
      const prevStep = currentIndex > 0 ? scenarioSteps[currentIndex - 1] : null;
      const nextStep = currentIndex >= 0 && currentIndex < scenarioSteps.length - 1 ? scenarioSteps[currentIndex + 1] : null;

      scenarioStepsHtml = `
        <div class="bt-scenario-stepper">
          <button class="bt-step-nav-btn" id="btn-prev-step" ${!prevStep ? 'disabled' : ''}>
            ◀ Step ${prevStep ? prevStep.stepNumber : ''}
          </button>
          <span>🎬 Step ${note.stepNumber || 1} of ${scenarioSteps.length}</span>
          <button class="bt-step-nav-btn" id="btn-next-step-card" ${!nextStep ? 'disabled' : ''}>
            Step ${nextStep ? nextStep.stepNumber : ''} ▶
          </button>
        </div>
      `;
    }

    backdrop.innerHTML = `
      <div class="bt-modal">
        <div class="bt-modal-header">
          <div class="bt-modal-title">
            <span>${note.scenarioId ? '🎬 ' + (note.scenarioTitle || 'Scenario Flow') : icon + ' Visual Note Details'}</span>
            <span class="bt-mode-badge ${badgeClass}">${note.type.toUpperCase()}</span>
            ${note.scenarioId && note.stepNumber ? `<span class="bt-mode-badge bt-badge-step">STEP ${note.stepNumber}</span>` : ''}
            <span class="bt-mode-badge ${statusClass}">${note.status}</span>
          </div>
          <button class="bt-close-btn" id="btn-card-close" title="Close (Esc)">✕</button>
        </div>

        ${scenarioStepsHtml}

        ${
          note.elementContext?.componentSource?.componentName
            ? `<div class="bt-component-pill" title="${
                note.elementContext.componentSource.sourceFile
                  ? note.elementContext.componentSource.sourceFile +
                    (note.elementContext.componentSource.sourceLine ? ':' + note.elementContext.componentSource.sourceLine : '')
                  : note.elementContext.componentSource.componentName
              }">
                <span>🧬</span>
                <span style="font-weight: 600; color: #a5b4fc;">&lt;${note.elementContext.componentSource.componentName}&gt;</span>
                ${
                  note.elementContext.componentSource.sourceFile
                    ? `<span style="color: #64748b; font-size: 11px; margin-left: 4px;">${note.elementContext.componentSource.sourceFile}${
                        note.elementContext.componentSource.sourceLine ? ':' + note.elementContext.componentSource.sourceLine : ''
                      }</span>`
                    : ''
                }
                ${
                  note.elementContext.componentSource.framework
                    ? `<span class="bt-mode-badge" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; margin-left: auto; font-size: 10px;">${note.elementContext.componentSource.framework.toUpperCase()}</span>`
                    : ''
                }
              </div>`
            : ''
        }

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
          <div style="display: flex; gap: 6px;">
            <button class="bt-btn bt-btn-delete" id="btn-card-delete" title="Delete this note">
              <span>🗑️</span> Delete
            </button>
            ${
              note.scenarioId
                ? `<button class="bt-btn bt-btn-delete" id="btn-card-delete-flow" title="Delete entire scenario flow">
                    <span>🗑️</span> Delete Flow
                  </button>`
                : ''
            }
          </div>
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
    const btnDeleteFlow = backdrop.querySelector('#btn-card-delete-flow') as HTMLButtonElement | null;
    const btnPrevStep = backdrop.querySelector('#btn-prev-step') as HTMLButtonElement | null;
    const btnNextStepCard = backdrop.querySelector('#btn-next-step-card') as HTMLButtonElement | null;

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

    if (btnPrevStep && scenarioSteps.length > 0) {
      const currentIndex = scenarioSteps.findIndex((s) => s.id === note.id);
      if (currentIndex > 0) {
        btnPrevStep.onclick = () => {
          this.openNoteCard(scenarioSteps[currentIndex - 1]);
        };
      }
    }

    if (btnNextStepCard && scenarioSteps.length > 0) {
      const currentIndex = scenarioSteps.findIndex((s) => s.id === note.id);
      if (currentIndex >= 0 && currentIndex < scenarioSteps.length - 1) {
        btnNextStepCard.onclick = () => {
          this.openNoteCard(scenarioSteps[currentIndex + 1]);
        };
      }
    }

    btnResolve.onclick = () => {
      if (note.status === 'OPEN') {
        this.transport.send({ type: 'resolve_note', noteId: note.id });
        this.showToast('Note marked as resolved', '✅');
      } else {
        this.transport.send({ type: 'reopen_note', noteId: note.id });
        this.showToast('Note reopened', '↺');
      }
      closeCard();
    };

    btnDelete.onclick = () => {
      this.transport.send({ type: 'delete_note', noteId: note.id });
      this.showToast('Note deleted', '🗑️');
      closeCard();
    };

    if (btnDeleteFlow && note.scenarioId) {
      btnDeleteFlow.onclick = () => {
        this.transport.send({ type: 'delete_scenario', scenarioId: note.scenarioId });
        this.showToast('Scenario flow deleted', '🗑️');
        closeCard();
      };
    }

    root.appendChild(backdrop);
  }

  private setupListeners(): void {
    // 1. Mouse move: hover highlight in element mode or with Alt key
    const onMouseMove = (e: MouseEvent) => {
      if (this.isHidden || this.modalOverlay || this.cardOverlay || this.isDraggingRegion || this.activeMode === 'region') return;

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
      if (this.isHidden || this.modalOverlay || this.cardOverlay) return;

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
          if (this.activeMode === 'element' && !this.activeScenario) {
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
          if (!this.activeScenario) {
            this.setMode('idle');
          }
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
          this.openRegionNoteEditor(this.selectedRegion);
        }

        if (this.regionBox) {
          this.regionBox.style.display = 'none';
        }
        if (!this.activeScenario) {
          this.setMode('idle');
        }
      };

      root.appendChild(this.regionOverlay);
    } else {
      this.regionOverlay.style.display = 'block';
    }
  }

  private hideRegionOverlay(): void {
    if (this.regionOverlay) {
      this.regionOverlay.style.display = 'none';
      this.isDraggingRegion = false;
      if (this.regionBox) {
        this.regionBox.style.display = 'none';
      }
    }
  }

  private updateHighlight(el: HTMLElement): void {
    const root = this.ensureContainer();
    if (!root || !this.highlightOverlay) return;

    const rect = el.getBoundingClientRect();
    this.highlightOverlay.style.display = 'block';
    this.highlightOverlay.style.left = `${rect.left}px`;
    this.highlightOverlay.style.top = `${rect.top}px`;
    this.highlightOverlay.style.width = `${rect.width}px`;
    this.highlightOverlay.style.height = `${rect.height}px`;

    let badge = this.highlightOverlay.querySelector('.bt-badge') as HTMLDivElement | null;
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'bt-badge';
      this.highlightOverlay.appendChild(badge);
    }

    const selector = getSemanticSelector(el);
    const label = this.activeScenario ? `🎬 Step ${this.activeScenario.stepNumber} · ${selector}` : selector;
    badge.textContent = `${label} (${Math.round(rect.width)} × ${Math.round(rect.height)} px)`;
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

    const comp = noteType === 'element' ? resolveComponentSource(targetEl) : undefined;
    const compPrefix = comp?.componentName
      ? `🧬 <${comp.componentName}>${comp.sourceFile ? ' (' + comp.sourceFile + (comp.sourceLine ? ':' + comp.sourceLine : '') + ')' : ''} · `
      : '';

    this.renderNoteModal({
      title: this.activeScenario
        ? `Step ${this.activeScenario.stepNumber}: ${this.activeScenario.title}`
        : 'Add Visual Note',
      modeBadge: this.activeScenario ? `STEP ${this.activeScenario.stepNumber}` : noteType.toUpperCase(),
      pillText:
        noteType === 'page'
          ? `Page Viewport: ${window.innerWidth} × ${window.innerHeight} px`
          : `${compPrefix}${getSemanticSelector(targetEl)} (${Math.round(targetEl.getBoundingClientRect().width)}×${Math.round(targetEl.getBoundingClientRect().height)}) · Viewport: ${window.innerWidth}×${window.innerHeight}`,
      onSave: async (message, action) => {
        let scenarioParam: { scenarioId?: string; stepNumber?: number; scenarioTitle?: string } | undefined;

        if (action === 'next_step' && !this.activeScenario) {
          this.startScenario();
        }

        if (this.activeScenario) {
          scenarioParam = {
            scenarioId: this.activeScenario.id,
            stepNumber: this.activeScenario.stepNumber,
            scenarioTitle: this.activeScenario.title,
          };
        }

        await this.saveVisualNote(targetEl, message, noteType, scenarioParam);

        if (action === 'next_step' && this.activeScenario) {
          this.activeScenario.stepNumber++;
          this.updateToolbarState();
          this.setMode('element');
        } else if (action === 'finish_flow' && this.activeScenario) {
          this.finishScenario();
        }
      },
    });
  }

  public openRegionNoteEditor(region: RegionContext): void {
    this.renderNoteModal({
      title: this.activeScenario
        ? `Step ${this.activeScenario.stepNumber}: ${this.activeScenario.title}`
        : 'Add Region Note',
      modeBadge: this.activeScenario ? `STEP ${this.activeScenario.stepNumber}` : 'REGION',
      pillText: `Selected Area: x:${region.x}, y:${region.y} (${region.width} × ${region.height} px)`,
      onSave: async (message, action) => {
        let scenarioParam: { scenarioId?: string; stepNumber?: number; scenarioTitle?: string } | undefined;

        if (action === 'next_step' && !this.activeScenario) {
          this.startScenario();
        }

        if (this.activeScenario) {
          scenarioParam = {
            scenarioId: this.activeScenario.id,
            stepNumber: this.activeScenario.stepNumber,
            scenarioTitle: this.activeScenario.title,
          };
        }

        await this.saveRegionVisualNote(region, message, scenarioParam);

        if (action === 'next_step' && this.activeScenario) {
          this.activeScenario.stepNumber++;
          this.updateToolbarState();
          this.setMode('element');
        } else if (action === 'finish_flow' && this.activeScenario) {
          this.finishScenario();
        }
      },
    });
  }

  private renderNoteModal(options: {
    title: string;
    modeBadge: string;
    pillText: string;
    onSave: (message: string, action: 'save' | 'next_step' | 'finish_flow') => Promise<void>;
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

    const isStep = options.modeBadge.startsWith('STEP');
    const badgeClass = isStep ? 'bt-badge-step' : `bt-badge-${options.modeBadge.toLowerCase()}`;
    const icon = isStep ? '🎬' : options.modeBadge === 'REGION' ? '📐' : options.modeBadge === 'PAGE' ? '📄' : '🎯';
    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

    backdrop.innerHTML = `
      <div class="bt-modal">
        <div class="bt-modal-header">
          <div class="bt-modal-title">
            <span>${icon} ${options.title}</span>
            <span class="bt-mode-badge ${badgeClass}">${options.modeBadge}</span>
          </div>
          <button class="bt-close-btn" id="btn-close" title="Close (Esc)">✕</button>
        </div>
        <div class="bt-target-pill" title="${options.pillText}">
          <span>${icon}</span>
          <span class="bt-pill-content">${options.pillText}</span>
        </div>
        <textarea class="bt-textarea" placeholder="Describe the layout issue, user action, or note for AI agent..." autofocus></textarea>
        <div class="bt-modal-footer">
          <div class="bt-kbd-hint">
            <kbd>${isMac ? '⌘' : 'Ctrl'}+Enter</kbd> save · <kbd>Esc</kbd> cancel
          </div>
          <div class="bt-modal-actions">
            <button class="bt-btn bt-btn-cancel" id="btn-cancel">Cancel</button>
            <button class="bt-btn bt-btn-next-step" id="btn-next-step" title="Save this step and immediately select the next element">
              <span>➡️</span> ${this.activeScenario ? 'Save & Next Step' : 'Save as Step 1 (Flow)'}
            </button>
            ${
              this.activeScenario
                ? `<button class="bt-btn bt-btn-finish-flow" id="btn-finish-flow" title="Save final step and complete scenario">
                    <span>✓</span> Save & Finish Flow
                  </button>`
                : `<button class="bt-btn bt-btn-save" id="btn-save">Save Note</button>`
            }
          </div>
        </div>
      </div>
    `;

    const textarea = backdrop.querySelector('textarea') as HTMLTextAreaElement;
    const btnClose = backdrop.querySelector('#btn-close') as HTMLButtonElement;
    const btnCancel = backdrop.querySelector('#btn-cancel') as HTMLButtonElement;
    const btnSave = backdrop.querySelector('#btn-save') as HTMLButtonElement | null;
    const btnNextStep = backdrop.querySelector('#btn-next-step') as HTMLButtonElement;
    const btnFinishFlow = backdrop.querySelector('#btn-finish-flow') as HTMLButtonElement | null;

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

    const handleAction = async (action: 'save' | 'next_step' | 'finish_flow') => {
      const message = textarea.value.trim();
      if (!message) return;

      btnNextStep.disabled = true;
      if (btnSave) btnSave.disabled = true;
      if (btnFinishFlow) btnFinishFlow.disabled = true;

      try {
        await options.onSave(message, action);
      } finally {
        closeModal();
      }
    };

    if (btnSave) {
      btnSave.onclick = () => handleAction('save');
    }
    btnNextStep.onclick = () => handleAction('next_step');
    if (btnFinishFlow) {
      btnFinishFlow.onclick = () => handleAction('finish_flow');
    }

    textarea.onkeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleAction(this.activeScenario ? 'next_step' : 'save');
      }
      if (e.key === 'Escape') {
        closeModal();
      }
    };

    root.appendChild(backdrop);
    setTimeout(() => textarea?.focus(), 50);
  }

  public async saveVisualNote(
    targetEl: HTMLElement,
    message: string,
    noteType: 'element' | 'page' = 'element',
    scenario?: { scenarioId?: string; stepNumber?: number; scenarioTitle?: string }
  ): Promise<void> {
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

    const route = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
    const url = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
    const viewport = typeof window !== 'undefined'
      ? { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 }
      : { width: 1280, height: 800, devicePixelRatio: 1 };
    const scroll = typeof window !== 'undefined'
      ? { scrollX: window.scrollX, scrollY: window.scrollY }
      : { scrollX: 0, scrollY: 0 };

    const notePayload = {
      type: 'create_note',
      sessionId: this.transport.getSessionId() || '',
      noteType,
      message,
      route,
      url,
      viewport,
      scroll,
      target,
      elementContext,
      screenshot: screenshotDataUrl,
      scenarioId: scenario?.scenarioId,
      stepNumber: scenario?.stepNumber,
      scenarioTitle: scenario?.scenarioTitle,
      timestamp: Date.now(),
    };

    this.transport.send(notePayload);
    if (this.options.onNoteCreated) {
      this.options.onNoteCreated(notePayload as any);
    }

    if (scenario?.scenarioId) {
      this.showToast(`Step ${scenario.stepNumber || 1} recorded`, '🎬');
    } else {
      this.showToast('Visual note saved', '✨');
    }
  }

  public async saveRegionVisualNote(
    region: RegionContext,
    message: string,
    scenario?: { scenarioId?: string; stepNumber?: number; scenarioTitle?: string }
  ): Promise<void> {
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

    const route = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
    const url = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
    const viewport = typeof window !== 'undefined'
      ? { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 }
      : { width: 1280, height: 800, devicePixelRatio: 1 };
    const scroll = typeof window !== 'undefined'
      ? { scrollX: window.scrollX, scrollY: window.scrollY }
      : { scrollX: 0, scrollY: 0 };

    const notePayload = {
      type: 'create_note',
      sessionId: this.transport.getSessionId() || '',
      noteType: 'region',
      message,
      route,
      url,
      viewport,
      scroll,
      region,
      screenshot: screenshotDataUrl,
      scenarioId: scenario?.scenarioId,
      stepNumber: scenario?.stepNumber,
      scenarioTitle: scenario?.scenarioTitle,
      timestamp: Date.now(),
    };

    this.transport.send(notePayload);
    if (this.options.onNoteCreated) {
      this.options.onNoteCreated(notePayload as any);
    }

    if (scenario?.scenarioId) {
      this.showToast(`Step ${scenario.stepNumber || 1} region recorded`, '🎬');
    } else {
      this.showToast('Region note saved', '📐');
    }
  }

  private extractElementContext(el: HTMLElement): ElementContext {
    const selector = getSemanticSelector(el);
    const attributes: Record<string, string> = {};

    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      if (
        this.options.maskSelectors?.some((mask) => {
          try {
            return el.matches(mask);
          } catch {
            return false;
          }
        }) &&
        (attr.name === 'value' || attr.name === 'data-secret')
      ) {
        attributes[attr.name] = '[REDACTED]';
      } else {
        attributes[attr.name] = attr.value;
      }
    }

    let outerHTML = el.outerHTML;
    if (outerHTML && outerHTML.length > 1000) {
      outerHTML = truncate(outerHTML, 1000);
    }

    let innerText = el.innerText || el.textContent || '';
    if (innerText && innerText.length > 200) {
      innerText = truncate(innerText, 200);
    }

    const componentSource = resolveComponentSource(el);

    return {
      selector,
      tag: el.tagName.toLowerCase(),
      attributes,
      outerHTML,
      innerText,
      componentSource,
      parent: el.parentElement
        ? {
            selector: getSemanticSelector(el.parentElement),
            tag: el.parentElement.tagName.toLowerCase(),
          }
        : undefined,
    };
  }

  private async cropDataUrl(dataUrl: string, region: RegionContext): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
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
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  public destroy(): void {
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
      this.shadowRoot = null;
    }
  }
}
