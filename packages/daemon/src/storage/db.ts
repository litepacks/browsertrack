import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Breadcrumb,
  ElementSummary,
  Incident,
  IncidentOccurrence,
  IncidentSeverity,
  IncidentStatus,
  NetworkEvent,
  Project,
  Session,
  VerificationResult,
  VisualNote,
  NoteStatus,
  NoteVerificationResult,
} from '../../../core/src/index.js';

export class StorageDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE,
        origin TEXT,
        path TEXT,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        origin TEXT,
        url TEXT,
        title TEXT,
        user_agent TEXT,
        connected_at TEXT,
        last_seen_at TEXT,
        active INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        event_type TEXT,
        payload TEXT,
        timestamp INTEGER,
        route TEXT,
        url TEXT
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        session_id TEXT,
        type TEXT,
        severity TEXT,
        message TEXT,
        source_file TEXT,
        source_line INTEGER,
        source_col INTEGER,
        fingerprint TEXT UNIQUE,
        route TEXT,
        first_seen TEXT,
        last_seen TEXT,
        occurrences INTEGER DEFAULT 1,
        status TEXT DEFAULT 'OPEN',
        stack TEXT,
        breadcrumbs TEXT,
        network_failures TEXT,
        last_element TEXT,
        screenshot_path TEXT
      );

      CREATE TABLE IF NOT EXISTS incident_occurrences (
        id TEXT PRIMARY KEY,
        incident_id TEXT,
        session_id TEXT,
        timestamp TEXT,
        route TEXT,
        url TEXT,
        stack TEXT,
        breadcrumbs TEXT,
        last_element TEXT
      );

      CREATE TABLE IF NOT EXISTS screenshots (
        id TEXT PRIMARY KEY,
        incident_id TEXT,
        file_path TEXT,
        format TEXT,
        width INTEGER,
        height INTEGER,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS verifications (
        id TEXT PRIMARY KEY,
        incident_id TEXT,
        status TEXT,
        checks TEXT,
        before_screenshot TEXT,
        after_screenshot TEXT,
        message TEXT,
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        session_id TEXT,
        type TEXT,
        message TEXT,
        route TEXT,
        url TEXT,
        viewport_json TEXT,
        scroll_json TEXT,
        target_json TEXT,
        element_context_json TEXT,
        region_json TEXT,
        screenshot_path TEXT,
        incident_id TEXT,
        status TEXT DEFAULT 'OPEN',
        created_at TEXT,
        updated_at TEXT,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS note_verifications (
        id TEXT PRIMARY KEY,
        note_id TEXT,
        status TEXT,
        checks TEXT,
        geometry_diff TEXT,
        before_screenshot TEXT,
        after_screenshot TEXT,
        message TEXT,
        created_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_incidents_project ON incidents(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_incidents_fp ON incidents(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id, status);
    `);
  }

  // --- PROJECTS ---
  public upsertProject(project: { id: string; name: string; origin: string; path?: string }): Project {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT * FROM projects WHERE name = ? OR origin = ?').get(project.name, project.origin) as any;

    if (existing) {
      this.db
        .prepare('UPDATE projects SET name = ?, origin = ?, path = COALESCE(?, path), updated_at = ? WHERE id = ?')
        .run(project.name, project.origin, project.path || null, now, existing.id);
      return {
        id: existing.id,
        name: project.name,
        origin: project.origin,
        path: project.path || existing.path,
        createdAt: existing.created_at,
        updatedAt: now,
      };
    }

    this.db
      .prepare('INSERT INTO projects (id, name, origin, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(project.id, project.name, project.origin, project.path || null, now, now);

    return {
      id: project.id,
      name: project.name,
      origin: project.origin,
      path: project.path,
      createdAt: now,
      updatedAt: now,
    };
  }

  public getProject(idOrName: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ? OR name = ?').get(idOrName, idOrName) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      origin: row.origin,
      path: row.path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public getProjectByOrigin(origin: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE origin = ?').get(origin) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      origin: row.origin,
      path: row.path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public listProjects(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as any[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      origin: row.origin,
      path: row.path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // --- SESSIONS ---
  public upsertSession(session: Session): void {
    const existing = this.db.prepare('SELECT id FROM sessions WHERE id = ?').get(session.id);
    if (existing) {
      this.db
        .prepare('UPDATE sessions SET url = ?, title = ?, last_seen_at = ?, active = ? WHERE id = ?')
        .run(session.url, session.title, session.lastSeenAt, session.active ? 1 : 0, session.id);
    } else {
      this.db
        .prepare(
          'INSERT INTO sessions (id, project_id, origin, url, title, user_agent, connected_at, last_seen_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          session.id,
          session.projectId,
          session.origin,
          session.url,
          session.title,
          session.userAgent,
          session.connectedAt,
          session.lastSeenAt,
          session.active ? 1 : 0
        );
    }
  }

  public getSession(id: string): Session | null {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      origin: row.origin,
      url: row.url,
      title: row.title,
      userAgent: row.user_agent,
      connectedAt: row.connected_at,
      lastSeenAt: row.last_seen_at,
      active: row.active === 1,
    };
  }

  public listSessions(projectId?: string, activeOnly = false): Session[] {
    let sql = 'SELECT * FROM sessions WHERE 1=1';
    const params: any[] = [];

    if (projectId) {
      sql += ' AND project_id = ?';
      params.push(projectId);
    }
    if (activeOnly) {
      sql += ' AND active = 1';
    }
    sql += ' ORDER BY last_seen_at DESC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      origin: row.origin,
      url: row.url,
      title: row.title,
      userAgent: row.user_agent,
      connectedAt: row.connected_at,
      lastSeenAt: row.last_seen_at,
      active: row.active === 1,
    }));
  }

  public deactivateSession(id: string): void {
    this.db.prepare('UPDATE sessions SET active = 0, last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  // --- EVENTS & RETENTION ---
  public insertEvent(event: {
    id: string;
    sessionId: string;
    eventType: string;
    payload: any;
    timestamp: number;
    route?: string;
    url?: string;
  }): void {
    this.db
      .prepare('INSERT INTO events (id, session_id, event_type, payload, timestamp, route, url) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        event.id,
        event.sessionId,
        event.eventType,
        JSON.stringify(event.payload),
        event.timestamp,
        event.route || '',
        event.url || ''
      );
  }

  public pruneSessionEvents(sessionId: string, maxEvents = 1000): void {
    this.db
      .prepare(
        `DELETE FROM events 
         WHERE session_id = ? AND id NOT IN (
           SELECT id FROM events WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?
         )`
      )
      .run(sessionId, sessionId, maxEvents);
  }

  public getEvents(options: { sessionId?: string; eventType?: string; limit?: number }): any[] {
    let sql = 'SELECT * FROM events WHERE 1=1';
    const params: any[] = [];

    if (options.sessionId) {
      sql += ' AND session_id = ?';
      params.push(options.sessionId);
    }
    if (options.eventType) {
      sql += ' AND event_type = ?';
      params.push(options.eventType);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(options.limit || 50);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      eventType: r.event_type,
      payload: JSON.parse(r.payload),
      timestamp: r.timestamp,
      route: r.route,
      url: r.url,
    }));
  }

  // --- INCIDENTS ---
  public findIncidentByFingerprint(fingerprint: string): Incident | null {
    const row = this.db.prepare('SELECT * FROM incidents WHERE fingerprint = ?').get(fingerprint) as any;
    if (!row) return null;
    return this.mapIncidentRow(row);
  }

  public getIncident(id: string): Incident | null {
    const row = this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapIncidentRow(row);
  }

  public listIncidents(options: { projectId?: string; status?: IncidentStatus; severity?: IncidentSeverity; limit?: number } = {}): Incident[] {
    let sql = 'SELECT * FROM incidents WHERE 1=1';
    const params: any[] = [];

    if (options.projectId) {
      sql += ' AND project_id = ?';
      params.push(options.projectId);
    }
    if (options.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }
    if (options.severity) {
      sql += ' AND severity = ?';
      params.push(options.severity);
    }

    sql += ' ORDER BY last_seen DESC LIMIT ?';
    params.push(options.limit || 50);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapIncidentRow(r));
  }

  public insertIncident(incident: Incident): void {
    this.db
      .prepare(
        `INSERT INTO incidents (
          id, project_id, session_id, type, severity, message, source_file, source_line, source_col,
          fingerprint, route, first_seen, last_seen, occurrences, status, stack, breadcrumbs,
          network_failures, last_element, screenshot_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        incident.id,
        incident.projectId,
        incident.sessionId,
        incident.type,
        incident.severity,
        incident.message,
        incident.source.file,
        incident.source.line,
        incident.source.column || null,
        incident.fingerprint,
        incident.route,
        incident.firstSeen,
        incident.lastSeen,
        incident.occurrences,
        incident.status,
        incident.stack || null,
        JSON.stringify(incident.breadcrumbs || []),
        JSON.stringify(incident.networkFailures || []),
        incident.lastElement ? JSON.stringify(incident.lastElement) : null,
        incident.screenshots?.error || null
      );
  }

  public updateIncidentOccurrence(
    incidentId: string,
    update: {
      sessionId: string;
      lastSeen: string;
      occurrences: number;
      route: string;
      breadcrumbs: Breadcrumb[];
      lastElement?: ElementSummary;
      stack?: string;
    }
  ): void {
    this.db
      .prepare(
        `UPDATE incidents 
         SET session_id = ?, last_seen = ?, occurrences = ?, route = ?, breadcrumbs = ?, last_element = COALESCE(?, last_element), stack = COALESCE(?, stack)
         WHERE id = ?`
      )
      .run(
        update.sessionId,
        update.lastSeen,
        update.occurrences,
        update.route,
        JSON.stringify(update.breadcrumbs || []),
        update.lastElement ? JSON.stringify(update.lastElement) : null,
        update.stack || null,
        incidentId
      );
  }

  public updateIncidentStatus(id: string, status: IncidentStatus): void {
    this.db.prepare('UPDATE incidents SET status = ? WHERE id = ?').run(status, id);
  }

  public insertIncidentOccurrence(occurrence: IncidentOccurrence): void {
    this.db
      .prepare(
        `INSERT INTO incident_occurrences (id, incident_id, session_id, timestamp, route, url, stack, breadcrumbs, last_element)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        occurrence.id,
        occurrence.incidentId,
        occurrence.sessionId,
        occurrence.timestamp,
        occurrence.route,
        occurrence.url,
        occurrence.stack || null,
        JSON.stringify(occurrence.breadcrumbs || []),
        occurrence.lastElement ? JSON.stringify(occurrence.lastElement) : null
      );
  }

  // --- VERIFICATIONS ---
  public insertVerification(v: {
    id: string;
    incidentId: string;
    status: IncidentStatus;
    checks: any[];
    beforeScreenshot?: string;
    afterScreenshot?: string;
    message?: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO verifications (id, incident_id, status, checks, before_screenshot, after_screenshot, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        v.id,
        v.incidentId,
        v.status,
        JSON.stringify(v.checks),
        v.beforeScreenshot || null,
        v.afterScreenshot || null,
        v.message || null,
        v.createdAt
      );
  }

  public getLatestVerification(incidentId: string): VerificationResult | null {
    const row = this.db.prepare('SELECT * FROM verifications WHERE incident_id = ? ORDER BY created_at DESC LIMIT 1').get(incidentId) as any;
    if (!row) return null;
    return {
      incidentId: row.incident_id,
      status: row.status as IncidentStatus,
      checks: JSON.parse(row.checks || '[]'),
      screenshots: {
        before: row.before_screenshot || undefined,
        after: row.after_screenshot || undefined,
      },
      timestamp: row.created_at,
      message: row.message || undefined,
    };
  }

  // --- VISUAL NOTES ---
  public insertNote(note: VisualNote): void {
    this.db
      .prepare(
        `INSERT INTO notes (
          id, project_id, session_id, type, message, route, url,
          viewport_json, scroll_json, target_json, element_context_json, region_json,
          screenshot_path, incident_id, status, created_at, updated_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        note.id,
        note.projectId,
        note.sessionId,
        note.type,
        note.message,
        note.route,
        note.url,
        JSON.stringify(note.viewport),
        JSON.stringify(note.scroll),
        note.target ? JSON.stringify(note.target) : null,
        note.elementContext ? JSON.stringify(note.elementContext) : null,
        note.region ? JSON.stringify(note.region) : null,
        note.screenshots?.original || null,
        note.incidentId || null,
        note.status,
        note.createdAt,
        note.updatedAt,
        note.resolvedAt || null
      );
  }

  public getNote(id: string): VisualNote | null {
    const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.mapNoteRow(row);
  }

  public listNotes(options: { projectId?: string; status?: NoteStatus; route?: string; limit?: number } = {}): VisualNote[] {
    let sql = 'SELECT * FROM notes WHERE 1=1';
    const params: any[] = [];

    if (options.projectId) {
      sql += ' AND project_id = ?';
      params.push(options.projectId);
    }
    if (options.status) {
      sql += ' AND status = ?';
      params.push(options.status);
    }
    if (options.route) {
      sql += ' AND route = ?';
      params.push(options.route);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(options.limit || 50);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => this.mapNoteRow(r));
  }

  public deleteNote(id: string): void {
    this.db.prepare('DELETE FROM note_verifications WHERE note_id = ?').run(id);
    this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  }

  public updateNoteStatus(id: string, status: NoteStatus): void {
    const now = new Date().toISOString();
    const resolvedAt = status === 'RESOLVED' ? now : null;
    this.db
      .prepare('UPDATE notes SET status = ?, updated_at = ?, resolved_at = COALESCE(?, resolved_at) WHERE id = ?')
      .run(status, now, resolvedAt, id);
  }

  public updateNote(id: string, updates: Partial<VisualNote>): void {
    const now = new Date().toISOString();
    const current = this.getNote(id);
    if (!current) return;

    this.db
      .prepare(
        `UPDATE notes 
         SET message = COALESCE(?, message), status = COALESCE(?, status),
             screenshot_path = COALESCE(?, screenshot_path), updated_at = ?
         WHERE id = ?`
      )
      .run(
        updates.message || null,
        updates.status || null,
        updates.screenshots?.original || updates.screenshots?.after || null,
        now,
        id
      );
  }

  public insertNoteVerification(v: NoteVerificationResult): void {
    this.db
      .prepare(
        `INSERT INTO note_verifications (
          id, note_id, status, checks, geometry_diff, before_screenshot, after_screenshot, message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `nver_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        v.noteId,
        v.status,
        JSON.stringify(v.checks),
        v.geometryDiff ? JSON.stringify(v.geometryDiff) : null,
        v.screenshots?.before || null,
        v.screenshots?.after || null,
        v.message || null,
        v.timestamp
      );
  }

  public getLatestNoteVerification(noteId: string): NoteVerificationResult | null {
    const row = this.db.prepare('SELECT * FROM note_verifications WHERE note_id = ? ORDER BY created_at DESC LIMIT 1').get(noteId) as any;
    if (!row) return null;
    return {
      noteId: row.note_id,
      status: row.status as NoteStatus,
      checks: JSON.parse(row.checks || '[]'),
      geometryDiff: row.geometry_diff ? JSON.parse(row.geometry_diff) : undefined,
      screenshots: {
        before: row.before_screenshot || undefined,
        after: row.after_screenshot || undefined,
      },
      timestamp: row.created_at,
      message: row.message || undefined,
    };
  }

  public clearAll(): void {
    this.db.exec(`
      DELETE FROM events;
      DELETE FROM incident_occurrences;
      DELETE FROM incidents;
      DELETE FROM screenshots;
      DELETE FROM verifications;
      DELETE FROM notes;
      DELETE FROM note_verifications;
      DELETE FROM sessions;
    `);
  }

  private mapIncidentRow(row: any): Incident {
    return {
      id: row.id,
      projectId: row.project_id,
      sessionId: row.session_id,
      type: row.type,
      severity: row.severity as IncidentSeverity,
      message: row.message,
      source: {
        file: row.source_file,
        line: row.source_line,
        column: row.source_col || undefined,
      },
      fingerprint: row.fingerprint,
      route: row.route,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      occurrences: row.occurrences,
      status: row.status as IncidentStatus,
      stack: row.stack || undefined,
      breadcrumbs: JSON.parse(row.breadcrumbs || '[]'),
      networkFailures: JSON.parse(row.network_failures || '[]'),
      lastElement: row.last_element ? JSON.parse(row.last_element) : undefined,
      screenshots: row.screenshot_path
        ? {
            error: row.screenshot_path,
          }
        : undefined,
    };
  }

  private mapNoteRow(row: any): VisualNote {
    return {
      id: row.id,
      projectId: row.project_id,
      sessionId: row.session_id,
      type: row.type,
      message: row.message,
      route: row.route,
      url: row.url,
      viewport: JSON.parse(row.viewport_json || '{}'),
      scroll: JSON.parse(row.scroll_json || '{}'),
      target: row.target_json ? JSON.parse(row.target_json) : undefined,
      elementContext: row.element_context_json ? JSON.parse(row.element_context_json) : undefined,
      region: row.region_json ? JSON.parse(row.region_json) : undefined,
      status: row.status as NoteStatus,
      incidentId: row.incident_id || undefined,
      screenshots: row.screenshot_path
        ? {
            original: row.screenshot_path,
          }
        : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at || undefined,
    };
  }

  public close(): void {
    this.db.close();
  }
}
