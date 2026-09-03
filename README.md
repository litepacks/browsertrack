# BrowserTrack 🔍

> **Local browser diagnostics shared with coding agents through MCP.**

BrowserTrack is a lightweight, framework-agnostic local development daemon and Model Context Protocol (MCP) bridge. It automatically collects browser-side runtime errors, unhandled rejections, console logs, network failures, user breadcrumbs, and DOM snapshots—making them instantly accessible to AI coding assistants (Antigravity, Cursor, Claude Code) for rapid debugging and closed-loop verification.

---

## ⚡ Quick Start

### 1. Start the Local Daemon

```bash
npm install -g browsertrack
browsertrack start
```

This starts the local diagnostics server at `http://127.0.0.1:7331` (WebSocket at `ws://127.0.0.1:7331`).

> **⚡ Zero-Config Auto-Start**: If you configure BrowserTrack via MCP in your AI editor (Cursor, Antigravity, Claude Code), you do **not** need to manually run `browsertrack start`! The MCP server automatically launches and manages a **single background daemon (singleton)** on port `7331`. Multiple windows or sessions share this single daemon without duplicate processes or port conflicts.

### 2. Connect Your Web Project

#### Option A: Zero-install script tag (Plain HTML / Vite / Next.js)

```html
<script src="http://127.0.0.1:7331/client.js"></script>
```

#### Option B: NPM package (React / Vue / Svelte / Astro)

```bash
npm install -D browsertrack
```

In your main application entry point (e.g. `main.ts` or `index.tsx`):

```typescript
import 'browsertrack/client';
```

---

## 🤖 Coding Agent (MCP) Setup

Add BrowserTrack to your MCP client configuration:

### Cursor (`~/.cursor/mcp.json`) & Claude Code
```json
{
  "mcpServers": {
    "browsertrack": {
      "command": "npx",
      "args": ["browsertrack", "mcp"]
    }
  }
}
```

### Antigravity (`~/.gemini/antigravity-ide/mcp_config.json`)
```json
{
  "mcpServers": {
    "browsertrack": {
      "command": "browsertrack",
      "args": ["mcp"]
    }
  }
}
```

---

## 🛠️ MCP Tools Exposed to AI Agents

| MCP Tool | Description |
| :--- | :--- |
| `list_projects` | Lists registered local development projects and mapped filesystem paths. |
| `list_sessions` | Lists active browser tabs connected over WebSocket. |
| `list_incidents` | Lists grouped error incidents with occurrences, severity, and status. |
| `get_incident` | Retrieves concise, high-signal context (stack trace, breadcrumbs, network failures, last interacted element, error screenshot). |
| `get_console` | Retrieves recent console errors/warnings. |
| `get_network_failures` | Retrieves recent 4xx/5xx HTTP failures and aborted requests. |
| `get_breadcrumbs` | Returns user interaction timeline leading up to an error. |
| `get_page_state` | Queries live DOM/URL state from the active browser tab. |
| `capture_element` | Captures an on-demand screenshot of a specific element or full page. |
| `verify_incident` | Runs closed-loop verification: reloads browser, checks if error reoccurs, executes probes, captures after-screenshot, and returns verdict (`VERIFIED`, `FAILED`, `INCONCLUSIVE`). |
| `get_verification` | Returns latest verification result and before/after screenshot artifacts. |

---

## 💻 CLI Commands

```bash
browsertrack start             # Start local daemon
browsertrack start --verbose   # Verbose logging mode
browsertrack stop              # Stop background daemon
browsertrack status            # Check status & connected sessions

browsertrack projects          # List tracked projects
browsertrack project add myapp --origin http://localhost:5173 --path ~/projects/myapp

browsertrack errors            # List open runtime errors
browsertrack errors --project myapp

browsertrack clear             # Clear stored logs & incidents
browsertrack mcp               # Run MCP server over stdio
```

---

## 🛡️ Security & Privacy

- **Localhost Only**: Daemon strictly binds to `127.0.0.1`.
- **Sensitive Key Redaction**: Powered by `@visulima/redact` — `Authorization`, `Cookie`, `Set-Cookie`, passwords, API tokens, bearer tokens, JWTs, AWS credentials, credit cards, SSNs, and secret query parameters are automatically sanitized.
- **No Form Values**: Form inputs (`<input>`, `<textarea>`) are never inspected or collected.
- **Zero Request/Response Body**: Payload bodies are disabled by default.

---

## 🏗️ Architecture

```text
Browser Client (Vanilla / React / Vue / Vite)
      ↕ WebSocket (ws://127.0.0.1:7331)
Local Daemon (SQLite Persistence + Verification Engine)
      ↕ MCP (stdio)
Coding Agents (Antigravity / Cursor / Claude Code)
```

---

## 🧪 Testing

Run the automated test suite:

```bash
npm test
```

Start the interactive fixture app for manual and end-to-end verification:

```bash
npx serve examples/test-app
```
