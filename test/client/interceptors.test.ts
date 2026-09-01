import { describe, expect, it, vi } from 'vitest';
import { BreadcrumbBuffer } from '../../packages/client/src/breadcrumbs.js';
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
});
