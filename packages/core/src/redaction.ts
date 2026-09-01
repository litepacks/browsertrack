import { redact as visulimaRedact, standardRules, type Rules } from '@visulima/redact';

/**
 * Security and Redaction Utilities powered by @visulima/redact
 */

export const REDACTED_PLACEHOLDER = '[REDACTED]';

export const SENSITIVE_KEY_PATTERNS = [
  /^authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /password/i,
  /token/i,
  /secret/i,
  /api[-_]?key/i,
  /access[-_]?token/i,
  /refresh[-_]?token/i,
  /credentials/i,
  /private[-_]?key/i,
  /ssn/i,
  /credit[-_]?card/i,
  /cvv/i,
];

export const SENSITIVE_QUERY_PARAMS = [
  'token',
  'auth',
  'key',
  'apikey',
  'api_key',
  'secret',
  'password',
  'access_token',
  'refresh_token',
  'code',
  'signature',
];

/**
 * Developer security rules for @visulima/redact
 */
export const BROWSER_SECURITY_RULES: Rules = [
  { deep: true, key: 'password', replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'secret', replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'token', replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'authorization', replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'cookie', replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'set-cookie', replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'apikey', replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'api_key', replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'creditcard', pattern: /(?:\d[ -]*?){13,16}/, replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'cvv', replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/, replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'awsid', pattern: /\bAKIA[0-9A-Z]{16}\b/, replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'awskey', pattern: /\b[0-9a-zA-Z/+]{40}\b/, replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'jwt', pattern: /\beyJ[0-9a-zA-Z_\-]*\.[0-9a-zA-Z_\-]*\.[0-9a-zA-Z_\-]*\b/, replacement: REDACTED_PLACEHOLDER },
  { deep: true, key: 'slack_token', pattern: /\bxox[baprs]-[0-9a-zA-Z]{10,48}\b/, replacement: REDACTED_PLACEHOLDER },
];

export { visulimaRedact, standardRules };
export type { Rules };

/**
 * Checks if a property name matches any sensitive pattern
 */
export function isSensitiveKey(key: string): boolean {
  if (!key) return false;
  const cleaned = key.replace(/[-_]/g, '');
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key) || pattern.test(cleaned));
}

/**
 * Redacts sensitive query parameters from a URL string
 */
export function redactUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;

  try {
    const isRelative =
      !rawUrl.startsWith('http://') &&
      !rawUrl.startsWith('https://') &&
      !rawUrl.startsWith('ws://') &&
      !rawUrl.startsWith('wss://');
    const base = 'http://localhost';
    const parsed = new URL(rawUrl, base);

    let changed = false;
    for (const param of SENSITIVE_QUERY_PARAMS) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, REDACTED_PLACEHOLDER);
        changed = true;
      }
    }

    // Also check all query params against isSensitiveKey
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isSensitiveKey(key)) {
        parsed.searchParams.set(key, REDACTED_PLACEHOLDER);
        changed = true;
      }
    }

    if (!changed) return rawUrl;

    let result = isRelative ? parsed.pathname + parsed.search + parsed.hash : parsed.toString();
    // Normalize URL-encoded brackets %5BREDACTED%5D back to [REDACTED]
    result = result.replace(/%5BREDACTED%5D/g, REDACTED_PLACEHOLDER);
    return result;
  } catch {
    // If URL parsing fails, perform regex replace
    let safe = rawUrl;
    for (const param of SENSITIVE_QUERY_PARAMS) {
      const reg = new RegExp(`([?&]${param}=)[^&#]+`, 'gi');
      safe = safe.replace(reg, `$1${REDACTED_PLACEHOLDER}`);
    }
    return safe;
  }
}

/**
 * Redacts sensitive HTTP headers
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  if (!headers || typeof headers !== 'object') return {};

  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveKey(key)) {
      safe[key] = REDACTED_PLACEHOLDER;
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

/**
 * Deeply redacts sensitive keys and payload data from an object or array,
 * leveraging @visulima/redact rules combined with BrowserTrack URL/header sanitizers.
 */
export function redactSensitiveData<T = any>(data: T, maxDepth = 6, currentDepth = 0): T {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;
  if (currentDepth > maxDepth) return '[DEPTH_EXCEEDED]' as any;

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item, maxDepth, currentDepth + 1)) as any;
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data as Record<string, any>)) {
    if (typeof value === 'object' && value !== null) {
      result[key] = redactSensitiveData(value, maxDepth, currentDepth + 1);
    } else if (isSensitiveKey(key)) {
      result[key] = REDACTED_PLACEHOLDER;
    } else if (typeof value === 'string') {
      // Check if value is a URL containing secrets
      if (value.startsWith('http://') || value.startsWith('https://') || value.includes('?')) {
        result[key] = redactUrl(value);
      } else {
        try {
          result[key] = visulimaRedact(value, BROWSER_SECURITY_RULES);
        } catch {
          result[key] = value;
        }
      }
    } else {
      result[key] = value;
    }
  }

  return result as T;
}
