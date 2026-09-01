import crypto from 'node:crypto';
import type { WebSocket, WebSocketServer } from 'ws';
import type { ClientEventMessage, CommandResponse, HelloMessage } from '../../../core/src/index.js';
import type { IncidentEngine } from '../incidents/engine.js';
import type { NotesEngine } from '../notes/engine.js';
import type { SessionManager } from '../session/manager.js';
import type { StorageDB } from '../storage/db.js';

export function setupWebSocketServer(
  wss: WebSocketServer,
  db: StorageDB,
  sessionManager: SessionManager,
  incidentEngine: IncidentEngine,
  notesEngine?: NotesEngine,
  maxEventsPerSession = 1000,
  verbose = false
): void {
  wss.on('connection', (ws: WebSocket) => {
    let currentSessionId: string | null = null;

    ws.on('message', (raw: string | Buffer) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
        const data = JSON.parse(text);

        // 1. Hello handshake
        if (data.type === 'hello') {
          const hello = data as HelloMessage;
          const sessionId = `sess_${crypto.randomUUID().slice(0, 8)}`;
          currentSessionId = sessionId;

          // Determine or create project
          let project = hello.projectId ? db.getProject(hello.projectId) : null;
          if (!project && hello.origin) {
            project = db.getProjectByOrigin(hello.origin);
          }
          if (!project) {
            // Auto-create project based on origin or hostname
            let projName = 'default';
            try {
              const url = new URL(hello.origin || 'http://localhost');
              projName = url.port ? `app-${url.port}` : url.hostname;
            } catch {
              projName = 'app';
            }
            project = db.upsertProject({
              id: `proj_${crypto.randomUUID().slice(0, 8)}`,
              name: projName,
              origin: hello.origin || 'http://localhost',
            });
          }

          const now = new Date().toISOString();
          db.upsertSession({
            id: sessionId,
            projectId: project.id,
            origin: hello.origin || '',
            url: hello.url || '',
            title: hello.title || '',
            userAgent: hello.userAgent || '',
            connectedAt: now,
            lastSeenAt: now,
            active: true,
          });

          sessionManager.registerSocket(sessionId, ws, hello.origin || '', project.id);

          ws.send(
            JSON.stringify({
              type: 'hello_ack',
              sessionId,
              projectId: project.id,
              projectName: project.name,
            })
          );

          // Sync existing notes for this project on load
          const existingNotes = db.listNotes({ projectId: project.id, limit: 100 });
          ws.send(
            JSON.stringify({
              type: 'notes_sync',
              notes: existingNotes,
            })
          );

          if (verbose) {
            console.log(`[BrowserTrack] New session connected: ${sessionId} (${project.name} @ ${hello.origin})`);
          }
          return;
        }

        // 2. Client Event (runtime error, console, network, breadcrumb)
        if (data.type === 'event') {
          const eventMsg = data as ClientEventMessage;
          const sessionId = eventMsg.sessionId || currentSessionId;
          if (!sessionId) return;

          const eventId = `evt_${crypto.randomUUID().slice(0, 8)}`;
          db.insertEvent({
            id: eventId,
            sessionId,
            eventType: eventMsg.eventType,
            payload: eventMsg.payload,
            timestamp: eventMsg.timestamp || Date.now(),
            route: eventMsg.route,
            url: eventMsg.url,
          });

          // Session retention prune
          db.pruneSessionEvents(sessionId, maxEventsPerSession);

          // Incident processing
          const incident = incidentEngine.processClientEvent(eventMsg);
          if (incident && verbose) {
            console.log(
              `[BrowserTrack] Incident recorded: ${incident.id} (${incident.type}: ${incident.message}) [${incident.occurrences}x]`
            );
          }
          return;
        }

        // 3. Visual Note Creation
        if (data.type === 'create_note' && notesEngine) {
          const note = notesEngine.createNoteFromClient({
            sessionId: data.sessionId || currentSessionId || '',
            noteType: data.noteType,
            message: data.message,
            route: data.route,
            url: data.url,
            viewport: data.viewport,
            scroll: data.scroll,
            target: data.target,
            elementContext: data.elementContext,
            region: data.region,
            screenshot: data.screenshot,
            incidentId: data.incidentId,
            scenarioId: data.scenarioId,
            stepNumber: data.stepNumber,
            scenarioTitle: data.scenarioTitle,
          });

          if (verbose) {
            console.log(
              `[BrowserTrack] Visual note created: ${note.id} on ${note.route} ("${note.message}")${
                note.scenarioId ? ` [Scenario: ${note.scenarioTitle || note.scenarioId} Step ${note.stepNumber}]` : ''
              }`
            );
          }

          ws.send(
            JSON.stringify({
              type: 'note_created_ack',
              noteId: note.id,
              status: note.status,
              scenarioId: note.scenarioId,
              stepNumber: note.stepNumber,
            })
          );

          // Broadcast updated notes to all active browser tabs in this project
          const allNotes = db.listNotes({ projectId: note.projectId, limit: 100 });
          sessionManager.broadcastToProject(note.projectId, {
            type: 'notes_sync',
            notes: allNotes,
          });
          return;
        }

        // 4. Visual Note Status / Delete Actions
        if (data.type === 'resolve_note' && data.noteId) {
          const note = db.getNote(data.noteId);
          if (note) {
            db.updateNoteStatus(data.noteId, 'RESOLVED');
            const allNotes = db.listNotes({ projectId: note.projectId, limit: 100 });
            sessionManager.broadcastToProject(note.projectId, {
              type: 'notes_sync',
              notes: allNotes,
            });
          }
          return;
        }

        if (data.type === 'reopen_note' && data.noteId) {
          const note = db.getNote(data.noteId);
          if (note) {
            db.updateNoteStatus(data.noteId, 'OPEN');
            const allNotes = db.listNotes({ projectId: note.projectId, limit: 100 });
            sessionManager.broadcastToProject(note.projectId, {
              type: 'notes_sync',
              notes: allNotes,
            });
          }
          return;
        }

        if (data.type === 'delete_note' && data.noteId) {
          const note = db.getNote(data.noteId);
          if (note) {
            db.deleteNote(data.noteId);
            const allNotes = db.listNotes({ projectId: note.projectId, limit: 100 });
            sessionManager.broadcastToProject(note.projectId, {
              type: 'notes_sync',
              notes: allNotes,
            });
          }
          return;
        }

        if (data.type === 'delete_scenario' && data.scenarioId) {
          const scenario = db.getScenario(data.scenarioId);
          if (scenario) {
            db.deleteScenario(data.scenarioId);
            const allNotes = db.listNotes({ projectId: scenario.projectId, limit: 100 });
            sessionManager.broadcastToProject(scenario.projectId, {
              type: 'notes_sync',
              notes: allNotes,
            });
          }
          return;
        }

        if (data.type === 'get_notes') {
          const session = currentSessionId ? db.getSession(currentSessionId) : null;
          const projectId = data.projectId || session?.projectId;
          if (projectId) {
            const allNotes = db.listNotes({ projectId, limit: 100 });
            ws.send(
              JSON.stringify({
                type: 'notes_sync',
                notes: allNotes,
              })
            );
          }
          return;
        }

        // 5. Command Response
        if (data.type === 'command_response') {
          const res = data.response as CommandResponse;
          const sessionId = data.sessionId || currentSessionId;
          if (sessionId && res) {
            sessionManager.handleCommandResponse(sessionId, res);
          }
          return;
        }
      } catch (err: any) {
        if (verbose) {
          console.error('[BrowserTrack] WebSocket message error:', err?.message);
        }
      }
    });

    ws.on('close', () => {
      if (currentSessionId) {
        sessionManager.unregisterSocket(currentSessionId);
        if (verbose) {
          console.log(`[BrowserTrack] Session disconnected: ${currentSessionId}`);
        }
      }
    });

    ws.on('error', () => {
      if (currentSessionId) {
        sessionManager.unregisterSocket(currentSessionId);
      }
    });
  });
}
