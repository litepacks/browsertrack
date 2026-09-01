import { describe, expect, it } from 'vitest';
import type { VisualNote } from '../../packages/core/src/index.js';
import { getSemanticSelector, truncate } from '../../packages/core/src/index.js';

describe('Core Visual Notes Types & Helpers', () => {
  it('constructs a valid VisualNote object', () => {
    const note: VisualNote = {
      id: 'note_12345',
      projectId: 'proj_test',
      sessionId: 'sess_test',
      type: 'element',
      message: "Mobile'da buraya bak, sağa taşıyor",
      route: '/dashboard',
      url: 'http://localhost:3000/dashboard',
      viewport: {
        width: 390,
        height: 844,
        devicePixelRatio: 3,
      },
      scroll: {
        scrollX: 0,
        scrollY: 120,
      },
      target: {
        selector: '[data-testid="stats-card"]',
        boundingRect: {
          x: 20,
          y: 100,
          width: 420,
          height: 180,
          top: 100,
          left: 20,
          bottom: 280,
          right: 440,
        },
        visible: true,
        confidence: 'high',
      },
      elementContext: {
        selector: '[data-testid="stats-card"]',
        tag: 'section',
        attributes: {
          class: 'stats-card responsive',
          'data-testid': 'stats-card',
        },
        outerHTML: '<section class="stats-card responsive" data-testid="stats-card"><div>142K</div></section>',
      },
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(note.id).toBe('note_12345');
    expect(note.viewport.width).toBe(390);
    expect(note.target?.boundingRect.right).toBe(440);
    expect(note.target?.boundingRect.right).toBeGreaterThan(note.viewport.width);
    expect(note.status).toBe('OPEN');
  });

  it('truncates large outerHTML properly', () => {
    const longHtml = '<div>' + 'a'.repeat(20000) + '</div>';
    const truncated = truncate(longHtml, 10240);
    expect(truncated.length).toBeLessThanOrEqual(10243);
    expect(truncated.endsWith('...')).toBe(true);
  });
});
