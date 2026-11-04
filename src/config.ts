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

export function loadConfig(env: Record<string, string | undefined>): Config {
  return {
    apiUrl: parseApiUrl(env.CONNEXAGENTS_API_URL?.trim() || DEFAULT_API_URL),
    token: env.CONNEXAGENTS_TOKEN?.trim() || undefined,
    agentId: env.CONNEXAGENTS_AGENT_ID?.trim() || undefined,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }
}
