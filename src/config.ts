export const DEFAULT_API_URL = 'https://www.connexagents.com/api/v1'
export const DEFAULT_TIMEOUT_MS = 10_000

export interface Config {
  apiUrl: string
  token: string | undefined
  agentId: string | undefined
  timeoutMs: number
}

// Messages never echo the configured values: a URL can embed credentials.
export class ConfigError extends Error {}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

function parseApiUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConfigError("CONNEXAGENTS_API_URL n'est pas une URL valide.")
  }
  if (url.username || url.password) {
    throw new ConfigError("CONNEXAGENTS_API_URL ne doit pas contenir d'identifiants.")
  }
  if (url.search || url.hash) {
    throw new ConfigError('CONNEXAGENTS_API_URL ne doit contenir ni paramètres ni fragment.')
  }
  const isHttps = url.protocol === 'https:'
  const isLocalHttp = url.protocol === 'http:' && LOOPBACK.has(url.hostname)
  if (!isHttps && !isLocalHttp) {
    throw new ConfigError('CONNEXAGENTS_API_URL doit être en https (http accepté en local uniquement).')
  }
  const normalized = url.href.replace(/\/+$/, '')
  // GET /api/handoffs sits outside /api/v1: its URL is derived from this suffix.
  if (!normalized.endsWith('/api/v1')) {
    throw new ConfigError('CONNEXAGENTS_API_URL doit se terminer par /api/v1.')
  }
  return normalized
}

// The Claude Code plugin passes its userConfig options as CLAUDE_PLUGIN_OPTION_*.
// CONNEXAGENTS_* remain the fallback for use outside the plugin (npx, Claude Desktop).
// An empty or blank value counts as absent, so an unset plugin option falls back.
function read(env: Record<string, string | undefined>, option: string, legacy: string): string | undefined {
  return env[`CLAUDE_PLUGIN_OPTION_${option}`]?.trim() || env[legacy]?.trim() || undefined
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  return {
    apiUrl: parseApiUrl(read(env, 'API_URL', 'CONNEXAGENTS_API_URL') || DEFAULT_API_URL),
    token: read(env, 'TOKEN', 'CONNEXAGENTS_TOKEN'),
    agentId: read(env, 'AGENT_ID', 'CONNEXAGENTS_AGENT_ID'),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }
}
