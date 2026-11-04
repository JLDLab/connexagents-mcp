#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ConfigError, loadConfig } from './config.ts'
import { createServer } from './server.ts'

try {
  await createServer(loadConfig(process.env)).connect(new StdioServerTransport())
} catch (err) {
  // stdout carries the MCP protocol. Only config messages, which hold no value, are printed.
  console.error(err instanceof ConfigError ? err.message : 'Échec du démarrage du serveur MCP.')
  process.exit(1)
}
