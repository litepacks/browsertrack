import { describe, expect, it } from 'vitest';
import { redactHeaders, redactSensitiveData, redactUrl, REDACTED_PLACEHOLDER } from '../../packages/core/src/redaction.js';

describe('Redaction & Security', () => {
  it('should redact sensitive query parameters in URLs', () => {
    const raw = 'http://localhost:3000/api/users?token=supersecret123&page=1&apiKey=xyz987';
    const redacted = redactUrl(raw);

    expect(redacted).toContain(`token=${REDACTED_PLACEHOLDER}`);
    expect(redacted).toContain(`apiKey=${REDACTED_PLACEHOLDER}`);
    expect(redacted).toContain('page=1');
  });

  it('should redact sensitive headers', () => {
    const headers = {
      Authorization: 'Bearer eyJhbGciOi...',
      Cookie: 'session_id=12345; auth_token=abc',
      'Content-Type': 'application/json',
      'X-Api-Key': 'secret-key-1',
    };

    const redacted = redactHeaders(headers);
    expect(redacted['Authorization']).toBe(REDACTED_PLACEHOLDER);
    expect(redacted['Cookie']).toBe(REDACTED_PLACEHOLDER);
    expect(redacted['X-Api-Key']).toBe(REDACTED_PLACEHOLDER);
    expect(redacted['Content-Type']).toBe('application/json');
  });

  it('should deeply redact sensitive keys in nested payloads', () => {
    const payload = {
      user: {
        id: 42,
        name: 'Alice',
        password: 'PlainTextPassword!',
        auth: {
          accessToken: 'secret_token_val',
        },
      },
      redirectUrl: 'http://example.com/callback?code=secret_oauth_code',
    };

    const redacted = redactSensitiveData(payload);
    expect(redacted.user.name).toBe('Alice');
    expect(redacted.user.password).toBe(REDACTED_PLACEHOLDER);
    expect(redacted.user.auth.accessToken).toBe(REDACTED_PLACEHOLDER);
    expect(redacted.redirectUrl).toContain(REDACTED_PLACEHOLDER);
  });

  it('should support direct @visulima/redact standardRules for sensitive fields', () => {
    const data = {
      creditCard: '4111111111111111',
      token: 'jwt-header.payload.secret',
      email: 'john@example.com',
    };

    const redacted = redactSensitiveData(data);
    expect(redacted.creditCard).toBe(REDACTED_PLACEHOLDER);
    expect(redacted.token).toBe(REDACTED_PLACEHOLDER);
  });
});
