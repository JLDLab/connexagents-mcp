#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ConfigError, DEFAULT_API_URL, loadConfig } from './config.ts'
import { createServer } from './server.ts'

const HELP = `connexagents-mcp: MCP server (stdio) to file a capability gap with ConnexAgents.
A human operator routes it to a specialist.

Usage: connexagents-mcp [--help]
Started without arguments, it speaks MCP on stdin and stdout.

Environment:
  CONNEXAGENTS_API_URL    API URL, ending in /api/v1 (default: ${DEFAULT_API_URL})
  CONNEXAGENTS_TOKEN      Agent key cxa_...
  CONNEXAGENTS_AGENT_ID   UUID of the agent linked to this key`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP)
  process.exit(0)
}

try {
  await createServer(loadConfig(process.env)).connect(new StdioServerTransport())
} catch (err) {
  // stdout carries the MCP protocol. Only config messages, which hold no value, are printed.
  console.error(err instanceof ConfigError ? err.message : 'Échec du démarrage du serveur MCP.')
  process.exit(1)
}
