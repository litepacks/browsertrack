---
title: Getting Started
description: Installation, daemon setup, and browser client integration guide for BrowserTrack
order: 2
---

# Getting Started 🚀

Follow this guide to get BrowserTrack up and running in under 2 minutes.

---

## 1. Install & Start Daemon

Install BrowserTrack globally via npm:

```bash
npm install -g browsertrack
```

Start the background diagnostics server:

```bash
browsertrack start
```

This will initialize the local server at `http://127.0.0.1:7331` (WebSocket bridge on `ws://127.0.0.1:7331`) and SQLite database at `~/.browsertrack/browsertrack.db`.

---

## 2. Connect Your Web Application

Choose the integration method that best suits your tech stack:

### Option A: Zero-Install Script Tag (Plain HTML / Vite / Next.js / Astro)

Add the script tag to your root HTML or document layout:

```html
<script src="http://127.0.0.1:7331/client.js"></script>
```

> **Tip (Next.js / SSR)**: You can conditionally load this script tag only in development environments (`process.env.NODE_ENV !== 'production'`).

### Option B: NPM Package (React / Vue / Svelte / Angular)

Install the client package:

```bash
npm install -D browsertrack
```

Import the client in your main application entry point (e.g. `main.ts` or `src/index.tsx`):

```typescript
import 'browsertrack/client';
```

Or configure custom options programmatically:

```typescript
import { BrowserTrackClient } from 'browsertrack/client';

const client = new BrowserTrackClient({
  daemonUrl: 'ws://127.0.0.1:7331',
  captureErrors: true,
  captureConsole: true,
  captureNetwork: true,
  captureInteractions: true,
  notes: {
    enabled: true,
    shortcut: 'Alt+Click',
  },
}).init();
```

---

## 3. Configure Your IDE for MCP

Add BrowserTrack MCP server to your AI editor configuration:

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

---

## 4. Add Project Agent Guidelines

Place an `AGENTS.md` file in the root of your project to instruct AI agents on how and when to use BrowserTrack tools:

```markdown
# AGENTS.md
This project is integrated with BrowserTrack MCP. Always check `list_incidents` and `list_notes` when debugging runtime errors or fixing layout feedback. Use `verify_incident` and `verify_note` after making code changes.
```

---

## 5. Verify the Connection

Open your web application in any browser. You will see the floating BrowserTrack dock in the bottom-right corner with **Element**, **Region**, **Page**, and **Notes** controls!
