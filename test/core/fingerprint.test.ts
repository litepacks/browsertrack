import { describe, expect, it } from 'vitest';
import { computeFingerprint, normalizeErrorMessage, normalizeSourceFile } from '../../packages/core/src/fingerprint.js';

describe('Fingerprint Engine', () => {
  it('should normalize error messages with UUIDs, hex values, and timestamps', () => {
    const raw = 'Failed at 0x7ffee4b2a8 with user c9bf9e57-1685-4c89-bafb-ff5af830be8a on 2026-08-31T22:30:00Z';
    const normalized = normalizeErrorMessage(raw);
    expect(normalized).toBe('Failed at 0x<HEX> with user <UUID> on <TIMESTAMP>');
  });

  it('should normalize source file paths by stripping query parameters and origins', () => {
    expect(normalizeSourceFile('http://localhost:5173/src/App.tsx?t=1719283')).toBe('/src/App.tsx');
    expect(normalizeSourceFile('https://example.com/assets/main.js#line40')).toBe('/assets/main.js');
    expect(normalizeSourceFile('C:\\Users\\dev\\project\\src\\main.ts')).toBe('C:/Users/dev/project/src/main.ts');
  });

  it('should produce deterministic identical fingerprints for duplicate errors', () => {
    const fp1 = computeFingerprint({
      type: 'TypeError',
      message: 'Cannot read properties of undefined (reading "id")',
      sourceFile: 'http://localhost:5173/src/components/User.tsx?t=100',
      line: 42,
    });

    const fp2 = computeFingerprint({
      type: 'TypeError',
      message: 'Cannot read properties of undefined (reading "id")',
      sourceFile: 'http://localhost:5173/src/components/User.tsx?t=999',
      line: 42,
    });

    expect(fp1).toBe(fp2);
    expect(fp1.startsWith('fp_')).toBe(true);
  });

  it('should produce distinct fingerprints for errors at different lines or files', () => {
    const fp1 = computeFingerprint({
      type: 'TypeError',
      message: 'Cannot read properties of undefined',
      sourceFile: '/src/App.tsx',
      line: 10,
    });

    const fp2 = computeFingerprint({
      type: 'TypeError',
      message: 'Cannot read properties of undefined',
      sourceFile: '/src/App.tsx',
      line: 25,
    });

    expect(fp1).not.toBe(fp2);
  });
});
