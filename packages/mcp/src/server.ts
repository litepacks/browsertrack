import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getDaemonConfig } from '../../daemon/src/config.js';
import { StorageDB } from '../../daemon/src/storage/db.js';
import { ScreenshotStore } from '../../daemon/src/storage/screenshot-store.js';
import { SessionManager } from '../../daemon/src/session/manager.js';
import { NotesEngine } from '../../daemon/src/notes/engine.js';
import { NoteVerificationEngine } from '../../daemon/src/notes/verification.js';
import { VerificationEngine, createDaemon } from '../../daemon/src/index.js';
import type { McpContext } from './handlers.js';
import { handleToolCall } from './handlers.js';
import { TOOLS } from './tools.js';

export async function isDaemonRunning(host: string, port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${port}/health`, {
      signal: AbortSignal.timeout(600),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as any;
      return data?.name === 'browsertrack';
    }
  } catch {}
  return false;
}

function resolveCliPath(): string | null {
  if (process.argv[1]) {
    const candidate = process.argv[1];
    if (
      candidate.endsWith('cli/index.js') ||
      candidate.endsWith('browsertrack') ||
      candidate.endsWith('bin/browsertrack.js') ||
      candidate.endsWith('dist/cli/index.js')
    ) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const paths = [
      path.resolve(currentDir, '../cli/index.js'),
      path.resolve(currentDir, '../../cli/index.js'),
      path.resolve(currentDir, '../../dist/cli/index.js'),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  } catch {}

  return null;
}

function acquireBootLock(lockFile: string): boolean {
  try {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    try {
      const stats = fs.statSync(lockFile);
      // If older than 5 seconds, assume stale lock and break it
      if (Date.now() - stats.mtimeMs > 5000) {
        fs.unlinkSync(lockFile);
        const fd = fs.openSync(lockFile, 'wx');
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        return true;
      }
    } catch {}
    return false;
  }
}

function releaseBootLock(lockFile: string): void {
  try {
    if (fs.existsSync(lockFile)) {
      fs.unlinkSync(lockFile);
    }
  } catch {}
}

export interface McpServerOptions {
  dbPath?: string;
  context?: Partial<McpContext>;
  autoStartDaemon?: boolean;
  port?: number;
  host?: string;
  detached?: boolean;
}

export function createMcpServer(options: McpServerOptions = {}) {
  const config = getDaemonConfig({
    dbPath: options.dbPath,
    port: options.port,
    host: options.host,
  });
  const db = options.context?.db || new StorageDB(config.dbPath);
  const screenshotStore = new ScreenshotStore(config.screenshotsDir);
  const sessionManager = options.context?.sessionManager || new SessionManager(db);
  const verificationEngine = options.context?.verificationEngine || new VerificationEngine(db, sessionManager, screenshotStore);
  const notesEngine = new NotesEngine(db, screenshotStore);
  const noteVerificationEngine = options.context?.noteVerificationEngine || new NoteVerificationEngine(db, sessionManager, notesEngine);

  const ctx: McpContext = {
    db,
    sessionManager,
    verificationEngine,
    noteVerificationEngine,
    daemonUrl: `http://${config.host}:${config.port}`,
    ...options.context,
  };

  let embeddedDaemon: any = null;

  async function ensureDaemon(): Promise<void> {
    if (options.autoStartDaemon === false || options.context?.sessionManager) {
      return;
    }

    // 1. Fast path: check if a singleton daemon is already running
    if (await isDaemonRunning(config.host, config.port)) {
      console.error(`[BrowserTrack MCP] Connected to active singleton daemon at http://${config.host}:${config.port}`);
      return;
    }

    // 2. Concurrency lock to guarantee only ONE daemon is ever started across multiple IDE sessions
    const lockFile = path.join(config.dataDir, 'daemon_boot.lock');
    const hasLock = acquireBootLock(lockFile);

    if (!hasLock) {
      // Another session is currently booting the daemon, wait for it
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (await isDaemonRunning(config.host, config.port)) {
          console.error(`[BrowserTrack MCP] Connected to shared singleton daemon at http://${config.host}:${config.port}`);
          return;
        }
      }
    }

    try {
      // 3. Double-check before starting
      if (await isDaemonRunning(config.host, config.port)) {
        console.error(`[BrowserTrack MCP] Connected to shared singleton daemon at http://${config.host}:${config.port}`);
        return;
      }

      // 4. Detached background process (singleton daemon that survives across IDE windows/sessions)
      if (options.detached !== false) {
        const cliPath = resolveCliPath();
        if (cliPath && fs.existsSync(cliPath)) {
          try {
            const child = spawn(
              process.execPath,
              [cliPath, 'start', '--port', String(config.port), '--host', config.host],
              {
                detached: true,
                stdio: 'ignore',
                env: { ...process.env, BROWSERTRACK_DAEMON_DETACHED: '1' },
              }
            );
            child.unref();

            for (let i = 0; i < 30; i++) {
              await new Promise((r) => setTimeout(r, 100));
              if (await isDaemonRunning(config.host, config.port)) {
                console.error(
                  `[BrowserTrack MCP] Started singleton background daemon on http://${config.host}:${config.port}`
                );
                return;
              }
            }
          } catch (spawnErr: any) {
            console.error(
              `[BrowserTrack MCP] Detached daemon spawn failed (${spawnErr?.message}), falling back to in-process daemon.`
            );
          }
        }
      }

      // 5. In-process fallback (used when detached is false or in test runners)
      embeddedDaemon = createDaemon({
        host: config.host,
        port: config.port,
        dbPath: config.dbPath,
        screenshotsDir: config.screenshotsDir,
        verbose: false,
      });
      await embeddedDaemon.start();
      console.error(`[BrowserTrack MCP] Started singleton daemon on http://${config.host}:${config.port}`);

      ctx.db = embeddedDaemon.db;
      ctx.sessionManager = embeddedDaemon.sessionManager;
      ctx.verificationEngine = embeddedDaemon.verificationEngine;
      ctx.noteVerificationEngine = embeddedDaemon.noteVerificationEngine;

      const cleanup = () => {
        if (embeddedDaemon) {
          try {
            embeddedDaemon.stop();
          } catch {}
          embeddedDaemon = null;
        }
      };

      process.on('exit', cleanup);
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    } catch (err: any) {
      console.error(
        `[BrowserTrack MCP] Note: Daemon startup skipped (${err?.message}). Running MCP in standalone database mode.`
      );
    } finally {
      if (hasLock) {
        releaseBootLock(lockFile);
      }
    }
  }

  const server = new Server(
    {
      name: 'browsertrack-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleToolCall(name, args || {}, ctx);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error executing tool ${name}: ${err?.message || String(err)}`,
          },
        ],
      };
    }
  });

  return {
    server,
    ctx,
    ensureDaemon,
    async stopDaemon() {
      if (embeddedDaemon) {
        await embeddedDaemon.stop();
        embeddedDaemon = null;
      }
    },
    async startStdio() {
      await ensureDaemon();
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
  };
}
