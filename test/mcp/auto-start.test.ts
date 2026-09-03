import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMcpServer, isDaemonRunning } from '../../packages/mcp/src/server.js';

describe('BrowserTrack MCP Daemon Auto-Start', () => {
  let tempDir: string;
  const testPort = 7338;
  let serverInstance: ReturnType<typeof createMcpServer> | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt_mcp_autostart_'));
  });

  afterEach(async () => {
    if (serverInstance) {
      await serverInstance.stopDaemon();
      serverInstance = null;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should auto-start background HTTP/WS daemon if offline when ensureDaemon is invoked', async () => {
    const dbPath = path.join(tempDir, 'autostart.db');

    // 1. Initially, daemon should not be running on testPort
    const initiallyRunning = await isDaemonRunning('127.0.0.1', testPort);
    expect(initiallyRunning).toBe(false);

    // 2. Create MCP server configured with autoStartDaemon
    serverInstance = createMcpServer({
      dbPath,
      port: testPort,
      host: '127.0.0.1',
      autoStartDaemon: true,
      detached: false,
    });

    // 3. Trigger ensureDaemon (which runs prior to stdio connection)
    await serverInstance.ensureDaemon();

    // 4. Verify daemon is now online and responds to /health
    const isNowRunning = await isDaemonRunning('127.0.0.1', testPort);
    expect(isNowRunning).toBe(true);

    const resp = await fetch(`http://127.0.0.1:${testPort}/health`);
    expect(resp.ok).toBe(true);
    const health = await resp.json();
    expect(health.name).toBe('browsertrack');
    expect(health.status).toBe('ok');
  });

  it('should reuse the existing singleton daemon without spawning a duplicate when another session starts', async () => {
    const dbPath = path.join(tempDir, 'singleton.db');

    // 1. Session 1 starts the daemon
    serverInstance = createMcpServer({
      dbPath,
      port: testPort,
      host: '127.0.0.1',
      autoStartDaemon: true,
      detached: false,
    });
    await serverInstance.ensureDaemon();
    expect(await isDaemonRunning('127.0.0.1', testPort)).toBe(true);

    // 2. Session 2 initializes on the same port/host
    const session2 = createMcpServer({
      dbPath,
      port: testPort,
      host: '127.0.0.1',
      autoStartDaemon: true,
      detached: false,
    });

    // Session 2 calls ensureDaemon - must detect existing singleton daemon without throwing
    await expect(session2.ensureDaemon()).resolves.not.toThrow();

    // Verify single daemon is intact and healthy
    const resp = await fetch(`http://127.0.0.1:${testPort}/health`);
    expect(resp.ok).toBe(true);
    const health = await resp.json();
    expect(health.name).toBe('browsertrack');
    expect(health.status).toBe('ok');
  });
});
