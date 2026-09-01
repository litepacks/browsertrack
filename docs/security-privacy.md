---
title: Security & Privacy
description: Security architecture, localhost binding, form value exclusion, and @visulima/redact sensitive data sanitization
order: 7
---

# Security & Privacy 🛡️

BrowserTrack is built with privacy-by-design principles to ensure sensitive developer tokens, credentials, and user data never leak to AI models or external servers.

---

## 🔒 Core Security Principles

### 1. Strictly Localhost Bound
- The daemon binds exclusively to `127.0.0.1`.
- It cannot be reached from the public internet or external local network devices.

### 2. Comprehensive Sensitive Data Masking (@visulima/redact)
BrowserTrack integrates `@visulima/redact` to automatically scan and sanitize payloads before saving to SQLite or returning to MCP:
- **Authentication & Headers**: `Authorization` (Bearer tokens, Basic auth), `Cookie`, `Set-Cookie`.
- **API Keys & Credentials**: AWS Access Keys (`AKIA...`), Slack tokens (`xoxb-...`), JWTs (`eyJ...`), `private_key`, `secret`.
- **Financial & Personal Data**: Credit card numbers, CVV/CVD, SSN / Social Security Numbers.
- **Sensitive URL Parameters**: Query strings containing `token`, `key`, `apiKey`, `auth`, `secret`, `password`, `signature` are converted to `[REDACTED]`.

### 3. No Form Input Recording
- Values inside `<input>` and `<textarea>` fields are never read or stored.
- Password inputs (`<input type="password">`) in DOM snapshot clones are explicitly sanitized to `value="[REDACTED]"`.

### 4. Zero Request/Response Payloads
- Network event interceptors capture only URL endpoints, HTTP methods, status codes, and latency.
- Request and response body payloads are disabled by default.
