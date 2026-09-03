import { describe, expect, it, vi } from 'vitest';
import { safeAsync, safeExecute, safeJsonParse, safeJsonStringify } from '../../packages/core/src/safety.js';

describe('BrowserTrack Core Safety Utilities', () => {
  describe('safeJsonParse', () => {
    it('should parse valid JSON correctly', () => {
      const result = safeJsonParse('{"foo":"bar","num":42}', {});
      expect(result).toEqual({ foo: 'bar', num: 42 });
    });

    it('should return fallback on malformed JSON without throwing', () => {
      const fallback = { status: 'fallback' };
      const result = safeJsonParse('{ broken json: true', fallback);
      expect(result).toBe(fallback);
    });

    it('should handle null, undefined, or empty string gracefully', () => {
      expect(safeJsonParse(null, 'default')).toBe('default');
      expect(safeJsonParse(undefined, 'default')).toBe('default');
      expect(safeJsonParse('', 'default')).toBe('default');
    });

    it('should return raw object if input is already parsed object', () => {
      const obj = { already: 'object' };
      expect(safeJsonParse(obj, {})).toBe(obj);
    });
  });

  describe('safeJsonStringify', () => {
    it('should serialize simple objects into valid JSON', () => {
      const json = safeJsonStringify({ name: 'BrowserTrack', active: true });
      expect(JSON.parse(json)).toEqual({ name: 'BrowserTrack', active: true });
    });

    it('should serialize circular structures without throwing', () => {
      const circular: any = { name: 'circular-node' };
      circular.self = circular;
      circular.child = { parent: circular };

      let json = '';
      expect(() => {
        json = safeJsonStringify(circular);
      }).not.toThrow();

      expect(json).toContain('[Circular]');
      const parsed = JSON.parse(json);
      expect(parsed.name).toBe('circular-node');
      expect(parsed.self).toBe('[Circular]');
      expect(parsed.child.parent).toBe('[Circular]');
    });

    it('should serialize BigInt without throwing', () => {
      const obj = { id: BigInt(9007199254740991) };
      expect(() => safeJsonStringify(obj)).not.toThrow();
      expect(safeJsonStringify(obj)).toContain('9007199254740991');
    });

    it('should handle undefined gracefully', () => {
      expect(safeJsonStringify(undefined, 'empty')).toBe('empty');
    });
  });

  describe('safeExecute', () => {
    it('should return function result on success', () => {
      const res = safeExecute(() => 10 + 20, 0);
      expect(res).toBe(30);
    });

    it('should return fallback on error and notify onError callback', () => {
      const errorHandler = vi.fn();
      const res = safeExecute(
        () => {
          throw new Error('Test crash');
        },
        -1,
        errorHandler
      );

      expect(res).toBe(-1);
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toBe('Test crash');
    });
  });

  describe('safeAsync', () => {
    it('should resolve async function correctly', async () => {
      const res = await safeAsync(async () => 'resolved_val', 'fallback');
      expect(res).toBe('resolved_val');
    });

    it('should catch rejection without throwing and return fallback', async () => {
      const errorHandler = vi.fn();
      const res = await safeAsync(
        async () => {
          throw new Error('Async boom');
        },
        'fallback',
        errorHandler
      );

      expect(res).toBe('fallback');
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler.mock.calls[0][0].message).toBe('Async boom');
    });
  });
});
