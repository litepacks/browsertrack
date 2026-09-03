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

> **⚡ Zero-Config Auto-Start**: If you configure BrowserTrack via MCP in your AI coding editor (Cursor, Antigravity, Claude Desktop), you do **not** need to manually run `browsertrack start`. The MCP server automatically launches and manages the HTTP and WebSocket background daemon on port `7331`!

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

### Standard Configuration
```json
{
  "mcpServers": {
    "browsertrack": {
      "command": "npx",
      "args": ["-y", "browsertrack@latest", "mcp"]
    }
  }
}
```

---

### ⚠️ Troubleshooting: `executable file not found in $PATH`

If your editor throws an error like:
```text
Error: exec: "browsertrack": executable file not found in $PATH
# or
Error: exec: "npx": executable file not found in $PATH
```

#### Why does this happen?
GUI applications on macOS and Linux (Antigravity, Cursor, Claude Desktop, VS Code) are launched by the desktop window manager (such as `launchd` on macOS), **not** from your terminal shell. Therefore, they do **not** automatically source your `~/.zshrc`, `~/.bashrc`, or environment managers like **NVM**, **fnm**, **asdf**, **Volta**, or **Homebrew** (`/opt/homebrew/bin`).

#### Solutions:

##### Option A: Use Absolute Path to `npx` with `PATH` environment (Recommended)
Find your `npx` and `node` bin directory in your terminal:
```bash
which npx
# Example output: /Users/username/.nvm/versions/node/v20.19.5/bin/npx
```

Configure your MCP config with the full path, the `-y` flag (to prevent interactive installation prompts from stalling stdio), and the `PATH` environment variable:
```json
{
  "mcpServers": {
    "browsertrack": {
      "command": "/Users/username/.nvm/versions/node/v20.19.5/bin/npx",
      "args": ["-y", "browsertrack@latest", "mcp"],
      "env": {
        "PATH": "/Users/username/.nvm/versions/node/v20.19.5/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
      }
    }
  }
}
```

##### Option B: Run Directly via Node (Fastest for Local Development)
If you are developing or running BrowserTrack locally, bypass `npx` completely and execute the CLI entry script directly with `node`:
```json
{
  "mcpServers": {
    "browsertrack": {
      "command": "/Users/username/.nvm/versions/node/v20.19.5/bin/node",
      "args": ["/absolute/path/to/browsertrack/dist/cli/index.js", "mcp"]
    }
  }
}
```

##### Option C: Wrap with Login Shell (`/bin/zsh -lc`)
Use your interactive login shell to automatically source your `~/.zshrc` and all environment variables:
```json
{
  "mcpServers": {
    "browsertrack": {
      "command": "/bin/zsh",
      "args": ["-lc", "npx -y browsertrack mcp"]
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
