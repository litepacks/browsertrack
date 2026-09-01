---
title: Incidents & Diagnostics
description: Automatic error grouping, runtime crash diagnostics, network tracking, and interaction breadcrumbs
order: 4
---

# Incidents & Diagnostics ⚠️

BrowserTrack continuously captures runtime errors, unhandled promise rejections, console warnings/errors, failed network calls, and user interaction breadcrumbs.

---

## ⚡ Automatic Error Grouping (Incidents)

Instead of overwhelming AI agents with duplicate errors, BrowserTrack uses intelligent fingerprinting:
- Grouped by `errorType`, normalized message, and source file line/column.
- Tracks `occurrences`, `firstSeen`, and `lastSeen` timestamps.
- Captures stack traces, route, and surrounding DOM state.

---

## 🍞 User Interaction Breadcrumbs

BrowserTrack maintains a bounded chronological timeline of events leading up to an error:
- **User Clicks**: Target selector, tag, text, and timestamp.
- **Form Focus/Blur**: Inputs engaged prior to crash (values are never recorded).
- **SPA & Browser Navigation**: `history.pushState` and URL route changes.
- **Console Logs**: `console.log`, `console.warn`, `console.error`.
- **Network Requests**: Method, URL, status code, and duration.

---

## 🌐 Network Failure Tracking

Failed HTTP requests (`4xx`, `5xx`, timeouts, and aborts) are captured with:
- Request method and sanitized URL (sensitive query parameters redacted by `@visulima/redact`).
- HTTP status code and response duration in ms.
- Error status and aborted flags.

---

## 🤖 Diagnostics Workflow for Coding Agents

```mermaid
sequenceDiagram
    participant Agent as AI Coding Agent
    participant MCP as BrowserTrack MCP
    participant Daemon as Local Daemon
    participant Browser as Browser Client

    Agent->>MCP: list_incidents({ status: "OPEN" })
    MCP->>Daemon: Query incidents from SQLite
    Daemon-->>Agent: Returns grouped incidents
    Agent->>MCP: get_incident({ incidentId: "inc_xxx" })
    MCP-->>Agent: Stack trace, source line, breadcrumbs, screenshot
    Agent->>Agent: Modifies code to fix bug
    Agent->>MCP: verify_incident({ incidentId: "inc_xxx" })
    MCP->>Browser: Dispatches reload & executes probes
    Browser-->>Daemon: Reports runtime status & captures screenshot
    Daemon-->>Agent: Verdict (VERIFIED / FAILED)
```
