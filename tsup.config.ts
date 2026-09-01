import { defineConfig } from 'tsup';

export default defineConfig([
  // Core, Client, Daemon, MCP Library exports
  {
    entry: {
      index: 'src/index.ts',
      'core/index': 'packages/core/src/index.ts',
      'client/index': 'packages/client/src/index.ts',
      'daemon/index': 'packages/daemon/src/index.ts',
      'mcp/index': 'packages/mcp/src/index.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node20',
  },
  // CLI Binary
  {
    entry: {
      'cli/index': 'packages/cli/src/index.ts',
    },
    format: ['esm'],
    banner: {
      js: '#!/usr/bin/env node',
    },
    sourcemap: true,
    target: 'node20',
  },
  // Client browser CJS bundle
  {
    entry: {
      'client/index': 'packages/client/src/index.ts',
    },
    format: ['cjs'],
    dts: false,
    target: 'es2020',
  },
  // Standalone browser client script (for http://127.0.0.1:7331/client.js)
  {
    entry: {
      'client.iife': 'packages/client/src/index.ts',
    },
    format: ['iife'],
    globalName: 'BrowserTrack',
    platform: 'browser',
    target: 'es2020',
    outExtension() {
      return { js: '.js' };
    },
    minify: true,
  },
]);
