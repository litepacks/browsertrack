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
      if (!sessionManager) {
        throw new Error('Live browser connection not available: Daemon session manager not attached.');
      }
      let session = args.sessionId ? db.getSession(args.sessionId) : sessionManager.getAnyActiveSession();
      if (!session) {
        throw new Error('No active browser session connected.');
      }

      const cmdRes = await sessionManager.sendCommand(session.id, {
        id: `cmd_mcp_${Date.now()}`,
        type: 'get_page_state',
      });

      if (!cmdRes.ok) {
        throw new Error(cmdRes.error || 'Failed to retrieve page state from browser.');
      }
      return cmdRes.result;
    }

    case 'capture_element': {
      if (!sessionManager) {
        throw new Error('Live browser connection not available: Daemon session manager not attached.');
      }
      let session = args.sessionId ? db.getSession(args.sessionId) : sessionManager.getAnyActiveSession();
      if (!session) {
        throw new Error('No active browser session connected.');
      }

      const cmdRes = await sessionManager.sendCommand(session.id, {
        id: `cmd_mcp_${Date.now()}`,
        type: 'capture_element',
        params: { selector: args.selector },
      });

      if (!cmdRes.ok) {
        throw new Error(cmdRes.error || cmdRes.reason || 'Failed to capture element screenshot.');
      }
      return {
        ok: true,
        format: cmdRes.result?.format || 'webp',
        width: cmdRes.result?.width,
        height: cmdRes.result?.height,
        dataUrlPreview: cmdRes.result?.dataUrl ? `${cmdRes.result.dataUrl.slice(0, 100)}...` : undefined,
      };
    }

    case 'verify_incident': {
      if (!verificationEngine) {
        throw new Error('Verification engine not available: Daemon session manager not attached.');
      }

      const res = await verificationEngine.verifyIncident(args.incidentId, {
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
      if (!noteVerificationEngine) {
        throw new Error('Note verification engine not available: Daemon session manager not attached.');
      }
      const res = await noteVerificationEngine.verifyNote(args.noteId, {
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
      if (!sessionManager) {
        throw new Error('Live browser connection not available: Daemon session manager not attached.');
      }
      let session = args.sessionId ? db.getSession(args.sessionId) : sessionManager.getAnyActiveSession();
      if (!session) {
        throw new Error('No active browser session connected.');
      }

      const queryCmd = await sessionManager.sendCommand(session.id, {
        id: `cmd_ctx_${Date.now()}`,
        type: 'query_element',
        params: { selector: args.selector },
      });

      const overflowCmd = await sessionManager.sendCommand(session.id, {
        id: `cmd_ovf_${Date.now()}`,
        type: 'check_overflow',
        params: { selector: args.selector },
      });

      const styleCmd = await sessionManager.sendCommand(session.id, {
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
