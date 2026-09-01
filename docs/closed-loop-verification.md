---
title: Closed-Loop Verification
description: Automated bug-fix verification, visual layout probes, before/after screenshot comparisons, and resolution verdicts
order: 5
---

# Closed-Loop Verification 🔄

BrowserTrack features an automated closed-loop verification engine for both runtime bug fixes and visual layout fixes.

---

## 🐞 Bug Fix Verification (`verify_incident`)

When an agent fixes a code bug, it triggers `verify_incident`:

1. **Browser Reload**: Reloads the active browser tab (or navigates to the incident route).
2. **Error Monitoring**: Watches for the incident fingerprint during an observation window (e.g. 2000ms).
3. **Probe Evaluation**: Evaluates custom verification probes:
   - `no_incident`: Confirms zero runtime errors occurred.
   - `element_exists`: Checks if a specific selector exists in the DOM.
   - `element_visible`: Confirms the target is rendered and visible.
   - `text_contains`: Asserts expected text content.
   - `route_is`: Verifies current SPA route.
4. **After Screenshot**: Automatically captures an after-fix screenshot.
5. **Verdict**: Returns `VERIFIED`, `FAILED`, or `INCONCLUSIVE`.

```typescript
// Example MCP call
await client.callTool("verify_incident", {
  incidentId: "inc_19a31a28",
  expect: [
    { type: "no_incident" },
    { type: "element_visible", selector: "#user-card" }
  ]
});
```

---

## 📐 Layout & Visual Note Verification (`verify_note`)

When an agent modifies CSS or HTML to resolve visual feedback, it triggers `verify_note`:

1. **Target Element Inspection**: Queries element visibility, bounding rect, and computed styles.
2. **Viewport Overflow Probe**: Checks if `rect.right > viewportWidth` or if container has unintended horizontal scroll.
3. **Geometry Diff**: Calculates before vs after dimensional delta (`widthDiff`, `heightDiff`, `overflowFixed`).
4. **After Screenshot**: Captures an updated visual snapshot.
5. **Verdict & Auto-Resolution**: If all checks pass and overflow is eliminated, returns `VERIFIED`.

```typescript
// Example MCP call
await client.callTool("verify_note", {
  noteId: "note_30a89599",
  observationWindowMs: 1000
});
```
