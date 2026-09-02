---
title: MCP Tool Reference
description: Complete reference for all 16 Model Context Protocol (MCP) tools exposed to AI coding agents
order: 6
---

# MCP Tool Reference 🛠️

BrowserTrack exposes 16 specialized Model Context Protocol (MCP) tools for AI agents.

---

## 📋 Incidents & Error Diagnostics

### `list_incidents`
Lists recorded browser runtime errors, unhandled rejections, and console errors grouped into incidents.
- **Arguments**:
  - `status` (`string`): Filter by `OPEN`, `FIX_ATTEMPTED`, `VERIFYING`, `VERIFIED`, `FAILED`, `INCONCLUSIVE`.
  - `severity` (`string`): Filter by `error`, `warn`, `fatal`.
  - `projectId` (`string`): Filter by project ID or name.
  - `limit` (`number`): Max number of incidents (default: 20).

### `get_incident`
Retrieves compact, high-signal debugging context for an error incident.
- **Arguments**:
  - `incidentId` (`string`, *required*): The unique ID of the incident (e.g. `inc_19a31a28`).
- **Returns**: Stack trace, normalized error message, breadcrumbs timeline, failed network calls, last interacted element (with `componentSource`: component name, source file, line number, hierarchy), and error screenshot.

### `get_console`
Fetches recent console logs, warnings, and errors from a browser session.
- **Arguments**:
  - `sessionId` (`string`): Browser session ID (optional, defaults to active session).
  - `limit` (`number`): Number of logs to retrieve (default: 30).

### `get_network_failures`
Retrieves recent failed HTTP requests (4xx, 5xx, timeouts, aborts).
- **Arguments**:
  - `sessionId` (`string`): Browser session ID (optional).
  - `limit` (`number`): Maximum number of failed requests (default: 20).

### `get_breadcrumbs`
Retrieves the chronological user interaction timeline leading up to an error.
- **Arguments**:
  - `incidentId` (`string`): Associated incident ID.
  - `sessionId` (`string`): Browser session ID.
  - `limit` (`number`): Max breadcrumbs (default: 50).

### `get_page_state`
Queries live DOM and URL state from the connected browser tab.
- **Arguments**:
  - `sessionId` (`string`): Target session ID (optional).

### `capture_element`
Captures an on-demand screenshot of a specific DOM element or the entire visible page.
- **Arguments**:
  - `selector` (`string`): CSS selector of the target element.
  - `sessionId` (`string`): Browser session ID (optional).

---

## 📝 Visual Notes & Layout Tools

### `list_notes`
Lists visual annotations left on elements, regions, or pages during development.
- **Arguments**:
  - `status` (`string`): `OPEN`, `IN_PROGRESS`, `VERIFYING`, `RESOLVED`, `FAILED`, `INCONCLUSIVE` (default: `OPEN`).
  - `projectId` (`string`): Filter by project ID or name.
  - `scenarioId` (`string`): Filter notes by scenario / flow ID.
  - `limit` (`number`): Max notes (default: 20).

### `list_scenarios`
Lists multi-step user reproduction scenarios and sequential interaction flows.
- **Arguments**:
  - `projectId` (`string`): Filter scenarios by project ID or name.
  - `status` (`string`): Filter by `OPEN` or `RESOLVED`.
  - `limit` (`number`): Max scenarios (default: 20).

### `get_scenario`
Retrieves full chronological step-by-step reproduction flow with selectors, route, screenshots, and action details.
- **Arguments**:
  - `scenarioId` (`string`, *required*): The unique ID of the scenario / flow (e.g. `scen_checkout_123`).

### `get_note`
Retrieves full debugging context for a visual note.
- **Arguments**:
  - `noteId` (`string`, *required*): The unique ID of the visual note (e.g. `note_30a89599`).
- **Returns**: Note message, route, viewport dimensions, target element selector, DOM context (including `componentSource` with framework, component name, source file path, and line number), screenshot file path, scenario metadata.

### `capture_note_context`
Inspects live DOM context, bounding box, overflow, and computed styles for a target element.
- **Arguments**:
  - `selector` (`string`, *required*): CSS selector of target element.
  - `sessionId` (`string`): Browser session ID (optional).

### `verify_note`
Runs closed-loop layout verification (visibility, viewport overflow, geometry delta, after-screenshot).
- **Arguments**:
  - `noteId` (`string`, *required*): The ID of the visual note to verify.
  - `observationWindowMs` (`number`): Observation window in ms (default: 1000).

### `get_note_verification`
Retrieves latest layout verification verdict, screenshots, and geometry diff.
- **Arguments**:
  - `noteId` (`string`, *required*): The ID of the visual note.

### `resolve_note`
Marks a visual note as `RESOLVED`.
- **Arguments**:
  - `noteId` (`string`, *required*): The ID of the visual note.

### `reopen_note`
Reopens a previously resolved visual note.
- **Arguments**:
  - `noteId` (`string`, *required*): The ID of the visual note.

---

## 🎛️ Session & Project Management

### `list_projects`
Lists all registered development projects and mapped filesystem paths.

### `list_sessions`
Lists active and recent browser tabs connected to the local development daemon.
- **Arguments**:
  - `projectId` (`string`): Filter sessions by project ID or name.
  - `activeOnly` (`boolean`): Show only active WebSocket sessions (default: `true`).

### `verify_incident`
Triggers closed-loop bug fix verification (reloads browser, evaluates probes, captures after-screenshot).
- **Arguments**:
  - `incidentId` (`string`, *required*): The ID of the incident.
  - `route` (`string`): Optional route to navigate to.
  - `targetSelector` (`string`): Optional element selector to inspect.
  - `expect` (`array`): Optional verification probes (`no_incident`, `element_exists`, `element_visible`, `text_contains`, `route_is`).
  - `observationWindowMs` (`number`): Observation window in ms (default: 2000).

### `get_verification`
Retrieves latest verification result and before/after screenshots for an incident.
- **Arguments**:
  - `incidentId` (`string`, *required*): The ID of the incident.
