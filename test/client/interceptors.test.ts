import { describe, expect, it, vi } from 'vitest';
import { BreadcrumbBuffer } from '../../packages/client/src/breadcrumbs.js';
import { shouldHideUIFromUrl } from '../../packages/client/src/config.js';
import { setupConsoleInterceptors } from '../../packages/client/src/interceptors/console.js';
import { NoteInspector } from '../../packages/client/src/notes/inspector.js';
import { getSemanticSelector } from '../../packages/core/src/selector.js';

describe('Client Interceptors & Utilities', () => {
  it('should patch console without breaking original console calls', () => {
    const originalError = console.error;
    const captured: any[] = [];

    const cleanup = setupConsoleInterceptors((event) => {
      captured.push(event);
    });

    console.error('Test error message', { code: 500 });

    expect(captured.length).toBe(1);
    expect(captured[0].level).toBe('error');
    expect(captured[0].message).toContain('Test error message');

    cleanup();

    // Verify restore
    expect(console.error).toBe(originalError);
  });

  it('should maintain bounded ring buffer capacity in BreadcrumbBuffer', () => {
    const buffer = new BreadcrumbBuffer(5);

    for (let i = 1; i <= 10; i++) {
      buffer.add({
        type: 'click',
        message: `click ${i}`,
      });
    }

    const recent = buffer.getRecent();
    expect(recent.length).toBe(5);
    expect(recent[0].message).toBe('click 6');
    expect(recent[4].message).toBe('click 10');
  });

  it('should produce semantic selector with data-testid priority', () => {
    const fakeElement = {
      tagName: 'BUTTON',
      getAttribute: (attr: string) => {
        if (attr === 'data-testid') return 'submit-btn';
        return null;
      },
      id: 'btn-1',
      classList: ['primary-btn'],
    } as any;

    const selector = getSemanticSelector(fakeElement);
    expect(selector).toBe('[data-testid="submit-btn"]');
  });

  it('should produce semantic selector with ID if no testid', () => {
    const fakeElement = {
      tagName: 'DIV',
      getAttribute: () => null,
      id: 'main-container',
      classList: ['app-body'],
    } as any;

    const selector = getSemanticSelector(fakeElement);
    expect(selector).toBe('#main-container');
  });

  it('should cleanly switch and cancel modes in NoteInspector', () => {
    const mockTransport = { send: vi.fn(), getSessionId: () => 'sess_123', onMessage: vi.fn(() => () => {}) } as any;
    const mockDriver = { captureElement: vi.fn() } as any;

    const inspector = new NoteInspector(mockTransport, mockDriver, {
      showToolbar: false,
    });

    inspector.setMode('region');
    expect((inspector as any).activeMode).toBe('region');

    // Switching to element mode should immediately clear region
    inspector.setMode('element');
    expect((inspector as any).activeMode).toBe('element');

    // Canceling / resetting to idle
    inspector.setMode('idle');
    expect((inspector as any).activeMode).toBe('idle');
    expect((inspector as any).isDraggingRegion).toBe(false);

    inspector.destroy();
  });

  it('should synchronize notes and render markers in NoteInspector', () => {
    const mockTransport = { send: vi.fn(), getSessionId: () => 'sess_123', onMessage: vi.fn(() => () => {}) } as any;
    const mockDriver = { captureElement: vi.fn() } as any;

    const inspector = new NoteInspector(mockTransport, mockDriver, {
      showToolbar: true,
    });

    inspector.init();

    const sampleNote = {
      id: 'note_test_1',
      projectId: 'proj_1',
      sessionId: 'sess_123',
      type: 'element' as const,
      message: 'Mobile layout overflow',
      route: '/',
      url: 'http://localhost/',
      viewport: { width: 400, height: 800, devicePixelRatio: 2 },
      scroll: { scrollX: 0, scrollY: 0 },
      target: {
        selector: 'body',
        boundingRect: { x: 10, y: 20, width: 100, height: 50, top: 20, left: 10, bottom: 70, right: 110 },
        visible: true,
        confidence: 'high' as const,
      },
      status: 'OPEN' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    inspector.syncNotes([sampleNote]);
    expect((inspector as any).savedNotes.length).toBe(1);

    inspector.destroy();
  });

  it('should support multi-step scenario recording flow in NoteInspector', async () => {
    const mockTransport = { send: vi.fn(), getSessionId: () => 'sess_123', onMessage: vi.fn(() => () => {}) } as any;
    const mockDriver = { captureElement: vi.fn().mockResolvedValue({ ok: false }) } as any;

    const inspector = new NoteInspector(mockTransport, mockDriver, {
      showToolbar: true,
    });

    inspector.init();

    inspector.startScenario('Checkout Journey');
    expect((inspector as any).activeScenario).not.toBeNull();
    expect((inspector as any).activeScenario.title).toBe('Checkout Journey');
    expect((inspector as any).activeScenario.stepNumber).toBe(1);
    expect((inspector as any).activeMode).toBe('element');

    const fakeElement = {
      tagName: 'BUTTON',
      id: 'checkout-button',
      getAttribute: () => null,
      attributes: [],
      classList: [],
      getBoundingClientRect: () => ({ x: 10, y: 20, width: 100, height: 40, top: 20, left: 10, bottom: 60, right: 110 }),
    } as any;

    await inspector.saveVisualNote(fakeElement, 'Click checkout', 'element', {
      scenarioId: (inspector as any).activeScenario.id,
      stepNumber: 1,
      scenarioTitle: 'Checkout Journey',
    });

    expect(mockTransport.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'create_note',
        scenarioId: expect.any(String),
        stepNumber: 1,
        scenarioTitle: 'Checkout Journey',
      })
    );

    inspector.finishScenario();
    expect((inspector as any).activeScenario).toBeNull();
    expect((inspector as any).activeMode).toBe('idle');

    inspector.destroy();
  });

  it('should support toast notifications in NoteInspector', () => {
    const mockTransport = { send: vi.fn(), getSessionId: () => 'sess_123', onMessage: vi.fn(() => () => {}) } as any;
    const mockDriver = { captureElement: vi.fn() } as any;

    const inspector = new NoteInspector(mockTransport, mockDriver, {
      showToolbar: true,
    });

    inspector.init();
    // Test showing toast without errors
    expect(() => {
      inspector.showToast('Test Toast Notification', '✨');
    }).not.toThrow();

    inspector.destroy();
  });

  it('should detect UI hide directives from various URL query strings', () => {
    // Built-in ?bt=0, ?bt=false, ?bt=hidden, ?bt=off, ?bt=none
    expect(shouldHideUIFromUrl(undefined, '?bt=0')).toBe(true);
    expect(shouldHideUIFromUrl(undefined, '?bt=false')).toBe(true);
    expect(shouldHideUIFromUrl(undefined, '?bt=hidden')).toBe(true);
    expect(shouldHideUIFromUrl(undefined, '?bt=off')).toBe(true);
    expect(shouldHideUIFromUrl(undefined, '?bt=none')).toBe(true);
    expect(shouldHideUIFromUrl(undefined, '?bt=disabled')).toBe(true);

    // ?browsertrack=false, ?browsertrack=0, ?browsertrack=hidden
    expect(shouldHideUIFromUrl(undefined, '?browsertrack=false')).toBe(true);
    expect(shouldHideUIFromUrl(undefined, '?browsertrack=0')).toBe(true);
    expect(shouldHideUIFromUrl(undefined, '?browsertrack=hidden')).toBe(true);

    // Flags: ?no_bt, ?no_browsertrack, ?hide_bt, ?hide_browsertrack
    expect(shouldHideUIFromUrl(undefined, '?no_bt')).toBe(true);
    expect(shouldHideUIFromUrl(undefined, '?no_bt=1')).toBe(true);
    expect(shouldHideUIFromUrl(undefined, '?no_browsertrack')).toBe(true);
    expect(shouldHideUIFromUrl(undefined, '?hide_bt=1')).toBe(true);
    expect(shouldHideUIFromUrl(undefined, '?hide_browsertrack=true')).toBe(true);
    expect(shouldHideUIFromUrl(undefined, '?bt_ui=0')).toBe(true);
    expect(shouldHideUIFromUrl(undefined, '?bt_hide=1')).toBe(true);

    // Custom query parameters
    expect(shouldHideUIFromUrl('clean_view', '?clean_view=1')).toBe(true);
    expect(shouldHideUIFromUrl(['e2e', 'cypress'], '?cypress=true')).toBe(true);

    // Non-hide queries
    expect(shouldHideUIFromUrl(undefined, '')).toBe(false);
    expect(shouldHideUIFromUrl(undefined, '?user=alice&tab=profile')).toBe(false);
    expect(shouldHideUIFromUrl(undefined, '?bt=1')).toBe(false);
    expect(shouldHideUIFromUrl(undefined, '?bt=true')).toBe(false);
  });

  it('should support hiding and toggling visibility in NoteInspector and BrowserTrackClient', () => {
    const mockTransport = { send: vi.fn(), getSessionId: () => 'sess_123', onMessage: vi.fn(() => () => {}) } as any;
    const mockDriver = { captureElement: vi.fn() } as any;

    const hiddenInspector = new NoteInspector(mockTransport, mockDriver, {
      showToolbar: true,
      hidden: true,
    });

    expect(hiddenInspector.isVisible()).toBe(false);

    // Toggling visibility
    hiddenInspector.setVisible(true);
    expect(hiddenInspector.isVisible()).toBe(true);

    hiddenInspector.setVisible(false);
    expect(hiddenInspector.isVisible()).toBe(false);

    hiddenInspector.destroy();
  });
});
