import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorageDB } from '../storage/db.js';
import type { SessionManager } from '../session/manager.js';

export function createHttpHandler(db: StorageDB, sessionManager: SessionManager, baseScreenshotsDir: string) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = parsedUrl.pathname;

    // CORS headers for local development access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Health check
    if (pathname === '/health' || pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          name: 'browsertrack',
          version: '0.1.0',
          activeSessions: sessionManager.getActiveCount(),
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    // 2. Client script tag bundle
    if (pathname === '/client.js' || pathname === '/browserdiag.js') {
      let scriptContent = '';
      try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        // Look in dist or adjacent package
        const candidatePaths = [
          path.resolve(__dirname, '../client.iife.js'),
          path.resolve(__dirname, '../../dist/client.iife.js'),
          path.resolve(__dirname, '../../../dist/client.iife.js'),
        ];

        for (const p of candidatePaths) {
          if (fs.existsSync(p)) {
            scriptContent = fs.readFileSync(p, 'utf-8');
            break;
          }
        }
      } catch {}

      if (!scriptContent) {
        scriptContent = `console.warn("[BrowserTrack] Standalone client bundle not built yet. Run 'npm run build'.");`;
      }

      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(scriptContent);
      return;
    }

    // 3. API - Projects
    if (pathname === '/api/projects') {
      const projects = db.listProjects();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, projects }));
      return;
    }

    // 4. API - Sessions
    if (pathname === '/api/sessions') {
      const projectId = parsedUrl.searchParams.get('project') || undefined;
      const activeOnly = parsedUrl.searchParams.get('active') === 'true';
      const sessions = db.listSessions(projectId, activeOnly);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sessions }));
      return;
    }

    // 5. API - Incidents
    if (pathname === '/api/incidents') {
      const projectId = parsedUrl.searchParams.get('project') || undefined;
      const status = (parsedUrl.searchParams.get('status') as any) || undefined;
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
      const incidents = db.listIncidents({ projectId, status, limit });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, incidents }));
      return;
    }

    // 6. API - Incident Detail
    if (pathname.startsWith('/api/incidents/')) {
      const incidentId = pathname.replace('/api/incidents/', '');
      const incident = db.getIncident(incidentId);
      if (!incident) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Incident not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, incident }));
      return;
    }

    // 7. API - Notes
    if (pathname === '/api/notes') {
      const projectId = parsedUrl.searchParams.get('project') || undefined;
      const status = (parsedUrl.searchParams.get('status') as any) || undefined;
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
      const notes = db.listNotes({ projectId, status, limit });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, notes }));
      return;
    }

    // 8. API - Note Detail
    if (pathname.startsWith('/api/notes/')) {
      const noteId = pathname.replace('/api/notes/', '');
      const note = db.getNote(noteId);
      if (!note) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Note not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, note }));
      return;
    }

    // 9. Screenshots Serving
    if (pathname.startsWith('/screenshots/')) {
      const relativePath = pathname.replace('/screenshots/', '');
      const filePath = path.join(baseScreenshotsDir, relativePath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.webp': 'image/webp',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Screenshot not found' }));
      return;
    }

    // Not found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  };
}
