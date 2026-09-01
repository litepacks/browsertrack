---
title: CLI Reference
description: Command-line interface commands for daemon control, project tracking, error logs, and documentation
order: 8
---

# CLI Reference 💻

BrowserTrack provides a complete command-line interface for managing the daemon, tracked projects, and runtime errors.

---

## ⚡ Commands

### Daemon Management
```bash
browsertrack start             # Start local daemon on http://127.0.0.1:7331
browsertrack start --verbose   # Start with verbose message logging
browsertrack stop              # Stop running daemon process
browsertrack status            # Check status and connected browser sessions
```

### Project Registry
```bash
browsertrack projects          # List all tracked projects
browsertrack project add <name> --origin <url> --path <path>
```

### Incident & Log Inspection
```bash
browsertrack errors            # List open runtime error incidents
browsertrack errors --project <name>
browsertrack clear             # Wipe stored logs, screenshots, and incidents
```

### MCP Integration
```bash
browsertrack mcp               # Start Model Context Protocol server over stdio
```

---

## 📖 Documentation Commands (Docboot)

To preview or build this documentation locally using [Docboot](https://github.com/litepacks/docboot):

```bash
npm run docs:dev     # Start live documentation server on http://localhost:3000
npm run docs:build   # Build static production documentation to dist-docs/
npm run docs:serve   # Preview production build locally
```
