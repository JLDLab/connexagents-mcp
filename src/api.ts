export type ApiResult = { ok: true; data: unknown } | { ok: false; message: string }

export const UNAUTHORIZED_MESSAGE = 'token opérateur manquant ou invalide'

interface ApiRequest {
  url: string
  // Route template, with no identifier in it.
  route: string
  token?: string
  timeoutMs: number
}

const TOKEN_PATTERN = /\b(?:cxa|cxo|knd)_[A-Za-z0-9_-]+/g
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g
const MAX_DETAIL_CHARS = 200

// A write that got no answer may still have been applied: the caller must know.
const UNKNOWN_WRITE_OUTCOME = " L'écriture a pu aboutir : vérifiez avant de relancer."

function apiErrorDetail(body: string, token: string | undefined): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return ''
  }
  const error = (parsed as { error?: unknown } | null)?.error
  if (typeof error !== 'string' || !error.trim()) return ''
  const masked = (token ? error.split(token).join('[masqué]') : error)
    .replace(TOKEN_PATTERN, '[masqué]')
    .replace(CONTROL_CHARS, ' ')
    .trim()
  return ` : ${Array.from(masked).slice(0, MAX_DETAIL_CHARS).join('')}`
}

// One attempt only. Redirects are reported, not followed, so the token
// cannot be carried to another address.
async function send(
  { url, route, token, timeoutMs }: ApiRequest,
  method: 'GET' | 'POST',
  payload?: unknown,
): Promise<ApiResult> {
  const unknownOutcome = method === 'POST' ? UNKNOWN_WRITE_OUTCOME : ''
  let response: Response
  let body: string
  try {
    response = await fetch(url, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/json',
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    })
    body = await response.text()
  } catch (err) {
    const name = (err as Error).name
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, message: `Délai de ${timeoutMs / 1000} s dépassé sur ${route}. Aucune nouvelle tentative.${unknownOutcome}` }
    }
    // Only a system code: the raw message of a fetch error is never relayed.
    const code = (err as { cause?: { code?: unknown } }).cause?.code
    const suffix = typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : ''
    return { ok: false, message: `Appel impossible sur ${route}${suffix}. Aucune nouvelle tentative.${unknownOutcome}` }
  }

  if (response.status === 401) {
    return { ok: false, message: `${UNAUTHORIZED_MESSAGE} (HTTP 401 sur ${route}).` }
  }
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, message: `Erreur API : HTTP ${response.status} sur ${route}${apiErrorDetail(body, token)}.` }
  }
  try {
    return { ok: true, data: JSON.parse(body) }
  } catch {
    return { ok: false, message: `Réponse illisible (HTTP ${response.status} sur ${route}) : JSON attendu.` }
  }
}

export function getJson(request: ApiRequest): Promise<ApiResult> {
  return send(request, 'GET')
}

export function postJson(request: ApiRequest, payload: unknown): Promise<ApiResult> {
  return send(request, 'POST', payload)
}
