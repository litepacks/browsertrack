import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getDaemonConfig } from '../../daemon/src/config.js';
import { StorageDB } from '../../daemon/src/storage/db.js';
import { ScreenshotStore } from '../../daemon/src/storage/screenshot-store.js';
import { SessionManager } from '../../daemon/src/session/manager.js';
import { NotesEngine } from '../../daemon/src/notes/engine.js';
import { NoteVerificationEngine } from '../../daemon/src/notes/verification.js';
import { VerificationEngine } from '../../daemon/src/verification/engine.js';
import type { McpContext } from './handlers.js';
import { handleToolCall } from './handlers.js';
import { TOOLS } from './tools.js';

export interface McpServerOptions {
  dbPath?: string;
  context?: Partial<McpContext>;
}

export function createMcpServer(options: McpServerOptions = {}) {
  const config = getDaemonConfig({ dbPath: options.dbPath });
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
    async startStdio() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
  };
}
