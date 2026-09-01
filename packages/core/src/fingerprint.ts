/**
 * Error fingerprinting and normalization utilities
 */

export interface FingerprintInput {
  type: string;
  message: string;
  sourceFile?: string;
  line?: number;
  column?: number;
  stack?: string;
}

/**
 * Normalizes error messages by stripping dynamic content like UUIDs, timestamps,
 * hex addresses, and file timestamps.
 */
export function normalizeErrorMessage(message: string): string {
  if (!message) return 'unknown_error';

  return message
    // Normalize string representation
    .trim()
    // Replace hex addresses (e.g. 0x7ffee4b2a8)
    .replace(/0x[0-9a-fA-F]+/g, '0x<HEX>')
    // Replace UUIDs
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '<UUID>')
    // Replace timestamp query params like ?t=1719283748 or ?v=1.2.3
    .replace(/\?[tv]=[\w.-]+/g, '')
    // Replace ISO timestamps
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<TIMESTAMP>')
    // Replace numbers in quotes/brackets if likely IDs (e.g., user "12345")
    .replace(/#\d+/g, '#<ID>')
    // Normalize whitespaces
    .replace(/\s+/g, ' ');
}

/**
 * Normalizes source filenames by removing origin and cache-busting query strings.
 */
export function normalizeSourceFile(filename?: string): string {
  if (!filename) return 'unknown_source';

  let cleaned = filename.trim();
  // Strip protocol and origin if present (e.g. http://localhost:5173/src/App.tsx?t=123)
  try {
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
      const url = new URL(cleaned);
      cleaned = url.pathname;
    }
  } catch {
    // fallback string manipulation
    cleaned = cleaned.replace(/^https?:\/\/[^/]+/, '');
  }

  // Remove query parameters
  cleaned = cleaned.split('?')[0].split('#')[0];

  // Normalize windows path separators
  cleaned = cleaned.replace(/\\/g, '/');

  return cleaned || 'unknown_source';
}

/**
 * Extracts source location from stack if not explicitly provided
 */
export function extractSourceFromStack(stack?: string): { file: string; line: number; column?: number } | null {
  if (!stack) return null;

  const lines = stack.split('\n');
  for (const line of lines) {
    // Match standard stack line: at functionName (http://localhost:5173/src/main.tsx:15:3) or at http://...:15:3
    const match = line.match(/(?:at\s+(?:.*?\s+\()?)?(https?:\/\/[^\s)]+|file:\/\/[^\s)]+|\/[^\s)]+):(\d+):(\d+)\)?/);
    if (match) {
      return {
        file: normalizeSourceFile(match[1]),
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
      };
    }
  }
  return null;
}

/**
 * Fast synchronous djb2-based hash for universal client/server runtime
 */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  // Convert to unsigned 32-bit hex string
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Computes a deterministic fingerprint for an error
 */
export function computeFingerprint(input: FingerprintInput): string {
  const normType = (input.type || 'Error').trim().toLowerCase();
  const normMsg = normalizeErrorMessage(input.message);

  let sourceFile = normalizeSourceFile(input.sourceFile);
  let line = input.line || 0;

  if ((sourceFile === 'unknown_source' || line === 0) && input.stack) {
    const extracted = extractSourceFromStack(input.stack);
    if (extracted) {
      sourceFile = extracted.file;
      line = extracted.line;
    }
  }

  const rawKey = `${normType}::${normMsg}::${sourceFile}::${line}`;
  const hash = djb2Hash(rawKey);

  return `fp_${hash}`;
}
