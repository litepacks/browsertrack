import type { StorageDB } from '../../daemon/src/storage/db.js';
import type { VerificationEngine } from '../../daemon/src/verification/engine.js';
import type { NoteVerificationEngine } from '../../daemon/src/notes/verification.js';
import type { SessionManager } from '../../daemon/src/session/manager.js';

export interface McpContext {
  db: StorageDB;
  sessionManager?: SessionManager;
  verificationEngine?: VerificationEngine;
  noteVerificationEngine?: NoteVerificationEngine;
  daemonUrl?: string;
}

async function sendSessionCommand(ctx: McpContext, sessionId: string | undefined, command: any, timeoutMs = 5000): Promise<any> {
  // 1. In-process session manager (if active sockets exist)
  if (ctx.sessionManager && ctx.sessionManager.getActiveCount() > 0) {
    const targetSession = sessionId ? ctx.db.getSession(sessionId) : ctx.sessionManager.getAnyActiveSession();
    if (targetSession) {
      const res = await ctx.sessionManager.sendCommand(targetSession.id, command, timeoutMs);
      if (!res.ok) {
        throw new Error(res.error || res.reason || `Command ${command.type} failed`);
      }
      return res;
    }
  }

  // 2. Multi-process proxy to running daemon HTTP server
  if (ctx.daemonUrl) {
    try {
      const resp = await fetch(`${ctx.daemonUrl}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, command, timeoutMs }),
        signal: AbortSignal.timeout(timeoutMs + 2000),
      });
      if (resp.ok) {
        const res = await resp.json();
        if (!res.ok) {
          throw new Error(res.error || res.reason || `Command ${command.type} failed`);
        }
        return res;
      }
      const errJson = await resp.json().catch(() => ({}));
      if (errJson.error) {
        throw new Error(errJson.error);
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('fetch failed') && !err.message.includes('ECONNREFUSED')) {
        throw err;
      }
    }
  }

  throw new Error(
    'No active browser session connected. Please ensure the BrowserTrack daemon is running ("browsertrack start") and your application tab is open in the browser.'
  );
}

async function runVerifyIncident(ctx: McpContext, incidentId: string, options: any): Promise<any> {
  if (ctx.verificationEngine && ctx.sessionManager && ctx.sessionManager.getActiveCount() > 0) {
    return await ctx.verificationEngine.verifyIncident(incidentId, options);
  }

  if (ctx.daemonUrl) {
    try {
      const timeoutMs = (options?.observationWindowMs || 3000) + 7000;
      const resp = await fetch(`${ctx.daemonUrl}/api/verify/incident`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId, options }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.ok) return data.result;
        throw new Error(data.error);
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('fetch failed') && !err.message.includes('ECONNREFUSED')) {
        throw err;
      }
    }
  }

  throw new Error(
    'Verification failed: No active browser session connected. Please ensure the BrowserTrack daemon is running ("browsertrack start") and your application tab is open in the browser.'
  );
}

async function runVerifyNote(ctx: McpContext, noteId: string, options: any): Promise<any> {
  if (ctx.noteVerificationEngine && ctx.sessionManager && ctx.sessionManager.getActiveCount() > 0) {
    return await ctx.noteVerificationEngine.verifyNote(noteId, options);
  }

  if (ctx.daemonUrl) {
    try {
      const timeoutMs = (options?.observationWindowMs || 3000) + 7000;
      const resp = await fetch(`${ctx.daemonUrl}/api/verify/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteId, options }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.ok) return data.result;
        throw new Error(data.error);
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('fetch failed') && !err.message.includes('ECONNREFUSED')) {
        throw err;
      }
    }
  }

  throw new Error(
    'Verification failed: No active browser session connected. Please ensure the BrowserTrack daemon is running ("browsertrack start") and your application tab is open in the browser.'
  );
}

export async function handleToolCall(name: string, args: any, ctx: McpContext): Promise<any> {
  const { db, sessionManager, verificationEngine, noteVerificationEngine } = ctx;

  switch (name) {
    case 'list_projects': {
      const projects = db.listProjects();
      return {
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          origin: p.origin,
          path: p.path,
          updatedAt: p.updatedAt,
        })),
      };
    }

    case 'list_sessions': {
      const activeOnly = args.activeOnly !== false;
      const sessions = db.listSessions(args.projectId, activeOnly);
      return {
        count: sessions.length,
        sessions: sessions.map((s) => ({
          id: s.id,
          projectId: s.projectId,
          origin: s.origin,
          url: s.url,
          title: s.title,
          active: s.active,
          lastSeenAt: s.lastSeenAt,
        })),
      };
    }

    case 'list_incidents': {
      const incidents = db.listIncidents({
        projectId: args.projectId,
        status: args.status,
        severity: args.severity,
        limit: args.limit || 20,
      });
      return {
        total: incidents.length,
        incidents: incidents.map((inc) => ({
          id: inc.id,
          type: inc.type,
          severity: inc.severity,
          message: inc.message,
          source: `${inc.source.file}:${inc.source.line}`,
          route: inc.route,
          status: inc.status,
          occurrences: inc.occurrences,
          firstSeen: inc.firstSeen,
          lastSeen: inc.lastSeen,
        })),
      };
    }

    case 'get_incident': {
      const incident = db.getIncident(args.incidentId);
      if (!incident) {
        throw new Error(`Incident '${args.incidentId}' not found.`);
      }

      // Compact breadcrumbs summary (last 10 most relevant)
      const breadcrumbsTimeline = incident.breadcrumbs.slice(-15).map((b) => {
        const time = new Date(b.timestamp).toISOString().split('T')[1]?.slice(0, 8);
        return `[${time}] ${b.message}`;
      });

      return {
        id: incident.id,
        status: incident.status,
        type: incident.type,
        severity: incident.severity,
        message: incident.message,
        source: {
          file: incident.source.file,
          line: incident.source.line,
          column: incident.source.column,
        },
        route: incident.route,
        occurrences: incident.occurrences,
        firstSeen: incident.firstSeen,
        lastSeen: incident.lastSeen,
        stack: incident.stack,
        lastInteractedElement: incident.lastElement
          ? {
              selector: incident.lastElement.selector,
              tag: incident.lastElement.tag,
              visible: incident.lastElement.visible,
              innerText: incident.lastElement.innerText,
              outerHTML: incident.lastElement.outerHTML,
              componentSource: incident.lastElement.componentSource,
            }
          : undefined,
        recentBreadcrumbs: breadcrumbsTimeline,
        networkFailures: incident.networkFailures,
        screenshot: incident.screenshots?.error,
      };
    }

    case 'get_console': {
      const limit = args.limit || 30;
      const events = db.getEvents({
        sessionId: args.sessionId,
        eventType: 'console',
        limit,
      });

      return {
        logs: events.map((e) => ({
          level: e.payload.level,
          message: e.payload.message,
          timestamp: new Date(e.timestamp).toISOString(),
          route: e.route,
        })),
      };
    }

    case 'get_network_failures': {
      const limit = args.limit || 20;
      const events = db.getEvents({
        sessionId: args.sessionId,
        limit: 100,
      });

      const failures = events
        .filter((e) => (e.eventType === 'fetch' || e.eventType === 'xhr') && (e.payload.status >= 400 || e.payload.error))
        .slice(0, limit)
        .map((e) => ({
          url: e.payload.url,
          method: e.payload.method,
          status: e.payload.status,
          error: e.payload.error,
          durationMs: e.payload.durationMs,
          timestamp: new Date(e.timestamp).toISOString(),
        }));

      return { failures };
    }

    case 'get_breadcrumbs': {
      if (args.incidentId) {
        const incident = db.getIncident(args.incidentId);
        if (!incident) {
          throw new Error(`Incident '${args.incidentId}' not found.`);
        }
        return {
          incidentId: args.incidentId,
          breadcrumbs: incident.breadcrumbs.slice(-(args.limit || 50)),
        };
      }

      const events = db.getEvents({
        sessionId: args.sessionId,
        limit: args.limit || 50,
      });

      return {
        breadcrumbs: events.map((e) => ({
          type: e.eventType,
          message: e.payload.message || `${e.eventType} on ${e.route}`,
          timestamp: new Date(e.timestamp).toISOString(),
          route: e.route,
        })),
      };
    }

    case 'get_page_state': {
      const cmdRes = await sendSessionCommand(ctx, args.sessionId, {
        id: `cmd_mcp_${Date.now()}`,
        type: 'get_page_state',
      });
      return cmdRes.result;
    }

    case 'capture_element': {
      const cmdRes = await sendSessionCommand(ctx, args.sessionId, {
        id: `cmd_mcp_${Date.now()}`,
        type: 'capture_element',
        params: { selector: args.selector },
      });

      return {
        ok: true,
        format: cmdRes.result?.format || 'webp',
        width: cmdRes.result?.width,
        height: cmdRes.result?.height,
        dataUrlPreview: cmdRes.result?.dataUrl ? `${cmdRes.result.dataUrl.slice(0, 100)}...` : undefined,
      };
    }

    case 'verify_incident': {
      const res = await runVerifyIncident(ctx, args.incidentId, {
        route: args.route,
        targetSelector: args.targetSelector,
        expect: args.expect,
        observationWindowMs: args.observationWindowMs,
      });

      return res;
    }

    case 'get_verification': {
      const v = db.getLatestVerification(args.incidentId);
      if (!v) {
        throw new Error(`No verification records found for incident '${args.incidentId}'.`);
      }
      return v;
    }

    case 'list_notes': {
      const notes = db.listNotes({
        projectId: args.projectId,
        scenarioId: args.scenarioId,
        status: args.status,
        limit: args.limit || 20,
      });

      return {
        total: notes.length,
        notes: notes.map((n) => ({
          id: n.id,
          type: n.type,
          status: n.status,
          route: n.route,
          scenarioId: n.scenarioId,
          stepNumber: n.stepNumber,
          scenarioTitle: n.scenarioTitle,
          viewport: `${n.viewport.width} × ${n.viewport.height}`,
          target: n.target?.selector || n.type,
          message: n.message,
          screenshotAvailable: !!n.screenshots?.original,
          createdAt: n.createdAt,
        })),
      };
    }

    case 'list_scenarios': {
      const scenarios = db.listScenarios({
        projectId: args.projectId,
        status: args.status,
        limit: args.limit || 20,
      });

      return {
        total: scenarios.length,
        scenarios: scenarios.map((s) => ({
          id: s.id,
          title: s.title,
          stepsCount: s.stepsCount,
          status: s.status,
          route: s.route,
          firstStepAt: s.firstStepAt,
          lastStepAt: s.lastStepAt,
        })),
      };
    }

    case 'get_scenario': {
      const scenario = db.getScenario(args.scenarioId);
      if (!scenario) {
        throw new Error(`Scenario '${args.scenarioId}' not found.`);
      }

      return {
        id: scenario.id,
        title: scenario.title,
        stepsCount: scenario.stepsCount,
        status: scenario.status,
        steps: scenario.steps.map((step) => ({
          id: step.id,
          stepNumber: step.stepNumber,
          type: step.type,
          message: step.message,
          route: step.route,
          url: step.url,
          targetSelector: step.target?.selector,
          boundingRect: step.target?.boundingRect || step.region,
          elementContext: step.elementContext,
          screenshot: step.screenshots?.original,
          status: step.status,
          createdAt: step.createdAt,
        })),
        createdAt: scenario.createdAt,
        updatedAt: scenario.updatedAt,
      };
    }

    case 'get_note': {
      const note = db.getNote(args.noteId);
      if (!note) {
        throw new Error(`Visual note '${args.noteId}' not found.`);
      }

      const project = db.getProject(note.projectId);

      return {
        id: note.id,
        type: note.type,
        status: note.status,
        message: note.message,
        scenarioId: note.scenarioId,
        stepNumber: note.stepNumber,
        scenarioTitle: note.scenarioTitle,
        route: note.route,
        url: note.url,
        viewport: note.viewport,
        scroll: note.scroll,
        target: note.target,
        elementContext: note.elementContext,
        region: note.region,
        screenshot: {
          available: !!note.screenshots?.original,
          original: note.screenshots?.original,
          after: note.screenshots?.after,
        },
        project: project
          ? {
              id: project.id,
              name: project.name,
              origin: project.origin,
              path: project.path,
            }
          : undefined,
        relatedIncidentId: note.incidentId,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        resolvedAt: note.resolvedAt,
      };
    }

    case 'resolve_note': {
      const note = db.getNote(args.noteId);
      if (!note) {
        throw new Error(`Visual note '${args.noteId}' not found.`);
      }
      db.updateNoteStatus(args.noteId, 'RESOLVED');
      return {
        ok: true,
        noteId: args.noteId,
        status: 'RESOLVED',
        resolvedAt: new Date().toISOString(),
      };
    }

    case 'reopen_note': {
      const note = db.getNote(args.noteId);
      if (!note) {
        throw new Error(`Visual note '${args.noteId}' not found.`);
      }
      db.updateNoteStatus(args.noteId, 'OPEN');
      return {
        ok: true,
        noteId: args.noteId,
        status: 'OPEN',
      };
    }

    case 'verify_note': {
      const res = await runVerifyNote(ctx, args.noteId, {
        observationWindowMs: args.observationWindowMs,
      });
      return res;
    }

    case 'get_note_verification': {
      const v = db.getLatestNoteVerification(args.noteId);
      if (!v) {
        throw new Error(`No verification records found for visual note '${args.noteId}'.`);
      }
      return v;
    }

    case 'capture_note_context': {
      const queryCmd = await sendSessionCommand(ctx, args.sessionId, {
        id: `cmd_ctx_${Date.now()}`,
        type: 'query_element',
        params: { selector: args.selector },
      });

      const overflowCmd = await sendSessionCommand(ctx, args.sessionId, {
        id: `cmd_ovf_${Date.now()}`,
        type: 'check_overflow',
        params: { selector: args.selector },
      });

      const styleCmd = await sendSessionCommand(ctx, args.sessionId, {
        id: `cmd_sty_${Date.now()}`,
        type: 'get_element_style',
        params: { selector: args.selector },
      });

      return {
        selector: args.selector,
        element: queryCmd.result,
        overflow: overflowCmd.result,
        styles: styleCmd.result?.styles,
      };
    }

    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}
