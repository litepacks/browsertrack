import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { getDaemonConfig } from '../../daemon/src/config.js';
import { createDaemon } from '../../daemon/src/index.js';
import { StorageDB } from '../../daemon/src/storage/db.js';
import { createMcpServer } from '../../mcp/src/server.js';

const program = new Command();
program.name('browsertrack').description('Local browser diagnostics + MCP bridge for coding agents').version('0.1.0');

function getPidFilePath(): string {
  const config = getDaemonConfig();
  return path.join(config.dataDir, 'daemon.pid');
}

function savePid(pid: number): void {
  const pidFile = getPidFilePath();
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, String(pid), 'utf-8');
}

function readPid(): number | null {
  try {
    const pidFile = getPidFilePath();
    if (fs.existsSync(pidFile)) {
      const pidStr = fs.readFileSync(pidFile, 'utf-8').trim();
      const pid = parseInt(pidStr, 10);
      if (!isNaN(pid)) return pid;
    }
  } catch {}
  return null;
}

function removePid(): void {
  try {
    const pidFile = getPidFilePath();
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  } catch {}
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 1. START
program
  .command('start')
  .description('Start the local BrowserTrack daemon and HTTP/WS server')
  .option('-p, --port <number>', 'Server port', '7331')
  .option('-h, --host <host>', 'Server host', '127.0.0.1')
  .option('-v, --verbose', 'Enable verbose logging', false)
  .action(async (options) => {
    const existingPid = readPid();
    if (existingPid && isProcessRunning(existingPid)) {
      console.log(`[BrowserTrack] Daemon is already running (PID: ${existingPid})`);
      return;
    }

    const port = parseInt(options.port, 10);
    const daemon = createDaemon({
      port,
      host: options.host,
      verbose: options.verbose,
    });

    try {
      await daemon.start();
      savePid(process.pid);

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  🔍 BrowserTrack Daemon Active');
      console.log(`  🌐 Server:    http://${daemon.config.host}:${daemon.config.port}`);
      console.log(`  🔌 WebSocket: ws://${daemon.config.host}:${daemon.config.port}`);
      console.log(`  📦 Script:    <script src="http://${daemon.config.host}:${daemon.config.port}/client.js"></script>`);
      console.log(`  💾 Database:  ${daemon.config.dbPath}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Graceful shutdown handling
      let isShuttingDown = false;
      const shutdown = async () => {
        if (isShuttingDown) {
          process.exit(0);
        }
        isShuttingDown = true;
        console.log('\n[BrowserTrack] Shutting down daemon...');
        removePid();

        // Safety fallback timer to prevent terminal freeze
        const forceExitTimer = setTimeout(() => {
          process.exit(0);
        }, 800);
        forceExitTimer.unref();

        try {
          await daemon.stop();
        } catch {}
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (err: any) {
      console.error('[BrowserTrack] Failed to start daemon:', err.message);
      process.exit(1);
    }
  });

// 2. STOP
program
  .command('stop')
  .description('Stop the running BrowserTrack daemon')
  .action(async () => {
    const pid = readPid();
    if (!pid || !isProcessRunning(pid)) {
      console.log('[BrowserTrack] Daemon is not currently running.');
      removePid();
      return;
    }

    try {
      process.kill(pid, 'SIGTERM');
      removePid();
      console.log(`[BrowserTrack] Stopped daemon (PID: ${pid}).`);
    } catch (err: any) {
      console.error(`[BrowserTrack] Failed to stop daemon:`, err.message);
    }
  });

// 3. STATUS
program
  .command('status')
  .description('Check if the BrowserTrack daemon is running and view active sessions')
  .action(async () => {
    const pid = readPid();
    const isRunning = pid ? isProcessRunning(pid) : false;
    const config = getDaemonConfig();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Status:       ${isRunning ? '🟢 RUNNING' : '⚪ STOPPED'}${isRunning ? ` (PID: ${pid})` : ''}`);
    console.log(`  Endpoint:     http://${config.host}:${config.port}`);
    console.log(`  Database:     ${config.dbPath}`);

    if (fs.existsSync(config.dbPath)) {
      try {
        const db = new StorageDB(config.dbPath);
        const projects = db.listProjects();
        const sessions = db.listSessions(undefined, true);
        const incidents = db.listIncidents({ limit: 100 });
        const openIncidents = incidents.filter((i) => i.status === 'OPEN');

        console.log(`  Projects:     ${projects.length}`);
        console.log(`  Live Sessions: ${sessions.length}`);
        console.log(`  Open Errors:  ${openIncidents.length} (${incidents.length} total recorded)`);
        db.close();
      } catch {}
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });

// 4. PROJECTS
const projectCommand = program.command('project').description('Manage tracked project mappings');

projectCommand
  .command('add <name>')
  .description('Register a project with origin and filesystem path')
  .requiredOption('-o, --origin <origin>', 'Project origin (e.g. http://localhost:5173)')
  .option('-p, --path <path>', 'Filesystem path (e.g. /path/to/project)')
  .action((name, options) => {
    const config = getDaemonConfig();
    const db = new StorageDB(config.dbPath);
    const resolvedPath = options.path ? path.resolve(options.path) : undefined;

    const proj = db.upsertProject({
      id: `proj_${name}`,
      name,
      origin: options.origin,
      path: resolvedPath,
    });

    console.log(`[BrowserTrack] Registered project '${proj.name}':`);
    console.log(`  ID:     ${proj.id}`);
    console.log(`  Origin: ${proj.origin}`);
    console.log(`  Path:   ${proj.path || '(none)'}`);
    db.close();
  });

program
  .command('projects')
  .description('List all tracked projects')
  .action(() => {
    const config = getDaemonConfig();
    const db = new StorageDB(config.dbPath);
    const projects = db.listProjects();

    if (projects.length === 0) {
      console.log('[BrowserTrack] No projects registered yet. Projects will be auto-detected upon browser connection.');
    } else {
      console.log('\nTracked Projects:');
      for (const p of projects) {
        console.log(`  • ${p.name.padEnd(16)} | ${p.origin.padEnd(26)} | ${p.path || '(auto-detected)'}`);
      }
      console.log('');
    }
    db.close();
  });

// 5. ERRORS / INCIDENTS
program
  .command('errors')
  .description('List recorded runtime errors and incidents')
  .option('-p, --project <project>', 'Filter by project name or ID')
  .option('-s, --status <status>', 'Filter by status (OPEN, VERIFIED, FAILED, etc.)')
  .option('-l, --limit <number>', 'Limit result count', '20')
  .action((options) => {
    const config = getDaemonConfig();
    const db = new StorageDB(config.dbPath);
    const limit = parseInt(options.limit, 10);
    const incidents = db.listIncidents({
      projectId: options.project,
      status: options.status,
      limit,
    });

    if (incidents.length === 0) {
      console.log('[BrowserTrack] No incidents found matching the filter.');
    } else {
      console.log(`\nIncidents (${incidents.length}):`);
      for (const inc of incidents) {
        const statusBadge =
          inc.status === 'OPEN'
            ? '🔴 OPEN'
            : inc.status === 'VERIFIED'
              ? '🟢 VERIFIED'
              : inc.status === 'FAILED'
                ? '❌ FAILED'
                : `⚪ ${inc.status}`;
        console.log(`  ${inc.id.padEnd(12)} [${statusBadge}] (${inc.occurrences}x) ${inc.type}: ${inc.message}`);
        console.log(`    Source: ${inc.source.file}:${inc.source.line} | Route: ${inc.route}`);
      }
      console.log('');
    }
    db.close();
  });

// 6. VISUAL NOTES
const noteCmd = program.command('note').description('Inspect or manage visual development notes');

noteCmd
  .command('show <noteId>')
  .description('Show full context for a specific visual note')
  .action((noteId) => {
    const config = getDaemonConfig();
    const db = new StorageDB(config.dbPath);
    const note = db.getNote(noteId);

    if (!note) {
      console.log(`[BrowserTrack] Note '${noteId}' not found.`);
    } else {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`  📝 Visual Note: ${note.id} [${note.status}]`);
      console.log(`  📍 Route:       ${note.route} (${note.url})`);
      console.log(`  📐 Viewport:    ${note.viewport.width} × ${note.viewport.height} (dpr: ${note.viewport.devicePixelRatio})`);
      if (note.target) {
        console.log(`  🎯 Target:      ${note.target.selector}`);
        console.log(`     Bounds:      x:${note.target.boundingRect.x}, y:${note.target.boundingRect.y}, ${note.target.boundingRect.width}×${note.target.boundingRect.height}`);
      }
      console.log(`  💬 Note:        "${note.message}"`);
      if (note.screenshots?.original) {
        console.log(`  🖼️  Screenshot:  ${note.screenshots.original}`);
      }
      console.log(`  🕒 Created:     ${note.createdAt}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
    db.close();
  });

noteCmd
  .command('resolve <noteId>')
  .description('Mark a visual note as resolved')
  .action((noteId) => {
    const config = getDaemonConfig();
    const db = new StorageDB(config.dbPath);
    const note = db.getNote(noteId);

    if (!note) {
      console.log(`[BrowserTrack] Note '${noteId}' not found.`);
    } else {
      db.updateNoteStatus(noteId, 'RESOLVED');
      console.log(`[BrowserTrack] Marked note '${noteId}' as RESOLVED.`);
    }
    db.close();
  });

noteCmd
  .command('reopen <noteId>')
  .description('Reopen a visual note')
  .action((noteId) => {
    const config = getDaemonConfig();
    const db = new StorageDB(config.dbPath);
    const note = db.getNote(noteId);

    if (!note) {
      console.log(`[BrowserTrack] Note '${noteId}' not found.`);
    } else {
      db.updateNoteStatus(noteId, 'OPEN');
      console.log(`[BrowserTrack] Reopened note '${noteId}' (status: OPEN).`);
    }
    db.close();
  });

program
  .command('notes')
  .description('List visual development notes')
  .option('-p, --project <project>', 'Filter by project name or ID')
  .option('-s, --status <status>', 'Filter by status (OPEN, RESOLVED, etc.)')
  .option('-l, --limit <number>', 'Limit result count', '20')
  .action((options) => {
    const config = getDaemonConfig();
    const db = new StorageDB(config.dbPath);
    const limit = parseInt(options.limit, 10);
    const notes = db.listNotes({
      projectId: options.project,
      status: options.status,
      limit,
    });

    if (notes.length === 0) {
      console.log('[BrowserTrack] No visual notes found.');
    } else {
      console.log(`\nVisual Notes (${notes.length}):`);
      for (const n of notes) {
        const badge = n.status === 'OPEN' ? '🟡 OPEN' : n.status === 'RESOLVED' ? '🟢 RESOLVED' : `⚪ ${n.status}`;
        console.log(`  ${n.id.padEnd(12)} [${badge}] Route: ${n.route.padEnd(16)} | Target: ${n.target?.selector || n.type}`);
        console.log(`    Note: "${n.message}" (${n.viewport.width}×${n.viewport.height})`);
      }
      console.log('');
    }
    db.close();
  });

// 7. INBOX (Errors + Visual Notes)
program
  .command('inbox')
  .description('View combined developer inbox with active runtime errors and visual notes')
  .option('-p, --project <project>', 'Filter by project name or ID')
  .action((options) => {
    const config = getDaemonConfig();
    const db = new StorageDB(config.dbPath);
    const incidents = db.listIncidents({ projectId: options.project, status: 'OPEN', limit: 20 });
    const notes = db.listNotes({ projectId: options.project, status: 'OPEN', limit: 20 });

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  📥 Browser Development Inbox ${options.project ? `(${options.project})` : ''}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (incidents.length === 0 && notes.length === 0) {
      console.log('  ✨ All clear! No open errors or visual notes.');
    } else {
      if (incidents.length > 0) {
        console.log(`\n  🚨 Runtime Errors (${incidents.length}):`);
        for (const inc of incidents) {
          console.log(`    • ${inc.id} (${inc.occurrences}x) ${inc.type}: ${inc.message}`);
          console.log(`      Route: ${inc.route} | Source: ${inc.source.file}:${inc.source.line}`);
        }
      }

      if (notes.length > 0) {
        console.log(`\n  📝 Visual Notes (${notes.length}):`);
        for (const n of notes) {
          console.log(`    • ${n.id} on ${n.route} (${n.viewport.width}×${n.viewport.height})`);
          console.log(`      Target: ${n.target?.selector || n.type} | Note: "${n.message}"`);
        }
      }
    }
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    db.close();
  });

// 6. CLEAR
program
  .command('clear')
  .description('Clear all stored incidents, events, and sessions from the database')
  .action(() => {
    const config = getDaemonConfig();
    const db = new StorageDB(config.dbPath);
    db.clearAll();
    console.log('[BrowserTrack] Database cleared.');
    db.close();
  });

// 7. MCP SERVER
program
  .command('mcp')
  .description('Launch the Model Context Protocol (MCP) server over stdio')
  .action(async () => {
    try {
      const server = createMcpServer();
      await server.startStdio();
    } catch (err: any) {
      console.error('[BrowserTrack] MCP Server error:', err?.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
