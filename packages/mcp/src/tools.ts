import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const TOOLS: Tool[] = [
  {
    name: 'list_projects',
    description: 'List all registered projects tracked by BrowserTrack/BrowserDiag',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_sessions',
    description: 'List active and recent browser sessions connected to the local development daemon',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Filter sessions by project ID or name' },
        activeOnly: { type: 'boolean', description: 'Show only currently active WebSocket sessions (default: true)' },
      },
    },
  },
  {
    name: 'list_incidents',
    description: 'List recorded browser runtime errors, unhandled rejections, and console errors grouped into incidents',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Filter by project ID or name' },
        status: {
          type: 'string',
          enum: ['OPEN', 'FIX_ATTEMPTED', 'VERIFYING', 'VERIFIED', 'FAILED', 'INCONCLUSIVE'],
          description: 'Filter by incident status',
        },
        severity: {
          type: 'string',
          enum: ['error', 'warn', 'fatal'],
          description: 'Filter by severity',
        },
        limit: { type: 'number', description: 'Maximum number of incidents to return (default: 20)' },
      },
    },
  },
  {
    name: 'get_incident',
    description: 'Retrieve compact and high-signal debugging context for a specific error incident (stack trace, breadcrumbs, network failures, last interacted element, error screenshot)',
    inputSchema: {
      type: 'object',
      properties: {
        incidentId: { type: 'string', description: 'The unique ID of the incident (e.g. inc_42)' },
      },
      required: ['incidentId'],
    },
  },
  {
    name: 'get_console',
    description: 'Get recent console logs, warnings, and errors from a browser session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID (optional, defaults to active session)' },
        limit: { type: 'number', description: 'Number of console logs to retrieve (default: 30)' },
      },
    },
  },
  {
    name: 'get_network_failures',
    description: 'Get recent failed HTTP network requests (4xx, 5xx, network errors, timeouts, aborts)',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID (optional)' },
        limit: { type: 'number', description: 'Maximum number of failed requests to return (default: 20)' },
      },
    },
  },
  {
    name: 'get_breadcrumbs',
    description: 'Get the sequence of recent user interactions, navigations, console logs, and network events prior to an error',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Browser session ID (optional)' },
        incidentId: { type: 'string', description: 'Incident ID to fetch breadcrumbs from (optional)' },
        limit: { type: 'number', description: 'Maximum number of breadcrumbs (default: 50)' },
      },
    },
  },
  {
    name: 'get_page_state',
    description: 'Query the live page state (URL, route, document title, readyState, active element) from the connected browser session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Target session ID (optional, defaults to active)' },
      },
    },
  },
  {
    name: 'capture_element',
    description: 'Capture a screenshot of a specific DOM element or the entire visible page in the active browser tab',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to capture (e.g. [data-testid="user-card"])' },
        sessionId: { type: 'string', description: 'Browser session ID (optional)' },
      },
    },
  },
  {
    name: 'verify_incident',
    description: 'Trigger closed-loop verification of a bug fix: reloads the browser, checks if the incident reoccurs, evaluates optional verification probes, and records before/after screenshots',
    inputSchema: {
      type: 'object',
      properties: {
        incidentId: { type: 'string', description: 'The ID of the incident to verify' },
        route: { type: 'string', description: 'Optional route to navigate to for verification (defaults to incident route)' },
        targetSelector: { type: 'string', description: 'Optional element selector to inspect and capture after-fix screenshot' },
        expect: {
          type: 'array',
          description: 'Optional verification probes to evaluate after reload',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['element_exists', 'element_visible', 'text_contains', 'route_is', 'no_incident'],
              },
              selector: { type: 'string' },
              text: { type: 'string' },
              route: { type: 'string' },
            },
            required: ['type'],
          },
        },
        observationWindowMs: { type: 'number', description: 'Observation window in milliseconds (default: 2000)' },
      },
      required: ['incidentId'],
    },
  },
  {
    name: 'get_verification',
    description: 'Retrieve the latest verification result and before/after screenshot artifacts for an incident',
    inputSchema: {
      type: 'object',
      properties: {
        incidentId: { type: 'string', description: 'The ID of the incident' },
      },
      required: ['incidentId'],
    },
  },
  {
    name: 'list_notes',
    description: 'List visual development notes / screen annotations left on elements, regions, or pages during development',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Filter notes by project ID or name' },
        status: {
          type: 'string',
          enum: ['OPEN', 'IN_PROGRESS', 'VERIFYING', 'RESOLVED', 'FAILED', 'INCONCLUSIVE'],
          description: 'Filter by note status (default: OPEN)',
        },
        limit: { type: 'number', description: 'Maximum number of notes to return (default: 20)' },
      },
    },
  },
  {
    name: 'get_note',
    description: 'Retrieve full debugging context for a visual note (message, route, viewport dimensions, target element selector, DOM context, screenshot file path, project path)',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: 'The unique ID of the visual note (e.g. note_42)' },
      },
      required: ['noteId'],
    },
  },
  {
    name: 'resolve_note',
    description: 'Mark a visual note as RESOLVED once the layout or styling issue has been fixed',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: 'The ID of the visual note to resolve' },
      },
      required: ['noteId'],
    },
  },
  {
    name: 'reopen_note',
    description: 'Reopen a previously resolved visual note',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: 'The ID of the visual note to reopen' },
      },
      required: ['noteId'],
    },
  },
  {
    name: 'verify_note',
    description: 'Run closed-loop layout & visual verification for a note: checks route, element existence/visibility, evaluates viewport overflow probes, captures after-screenshot, and computes geometry diff',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: 'The ID of the visual note to verify' },
        observationWindowMs: { type: 'number', description: 'Observation window in milliseconds (default: 1000)' },
      },
      required: ['noteId'],
    },
  },
  {
    name: 'get_note_verification',
    description: 'Retrieve the latest verification result, before/after screenshot references, and layout geometry diff for a visual note',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: { type: 'string', description: 'The ID of the visual note' },
      },
      required: ['noteId'],
    },
  },
  {
    name: 'capture_note_context',
    description: 'Inspect live DOM context, bounding box, overflow, and styles for a target element in the active browser tab',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the target element' },
        sessionId: { type: 'string', description: 'Browser session ID (optional)' },
      },
      required: ['selector'],
    },
  },
];
