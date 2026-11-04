// Local stand-in for the routes named in the README, and only those.
// All data is fictional.
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export const FAKE_AGENT_ID = '00000000-0000-4000-8000-000000000001'
export const BAIT = 'BAIT_MUST_NOT_REACH_TOOL_OUTPUT'

const FIRST_PARTNER_ID = '00000000-0000-4000-8000-000000000002'
const SECOND_PARTNER_ID = '00000000-0000-4000-8000-000000000003'

export const NEXT_STEP_FIXTURE =
  "Votre besoin est enregistré. Un opérateur ConnexAgents l'examine et vous proposera un spécialiste. Interrogez GET /api/v1/handoffs/{id}."

export const MATCHES_FIXTURE = {
  agent_id: FAKE_AGENT_ID,
  total: 2,
  matches: [
    {
      id: '00000000-0000-4000-8000-0000000000a1',
      intentionality_angle: 'Fictional angle: OAuth2 token refresh on third-party order APIs.',
      status_a: 'pending',
      status_b: 'pending',
      proposed_at: '2026-11-02T08:00:00.000Z',
      expires_at: '2026-11-09T08:00:00.000Z',
      // Outside the allowlist of src/tools.ts: must be dropped.
      dimensions: [{ label: BAIT, value: BAIT }],
      score_total: BAIT,
      partner: {
        id: FIRST_PARTNER_ID,
        contacts: BAIT,
        profile: {
          display_name: 'Fictional OAuth Specialist',
          capabilities_tags: ['api-integration', 'automation', 'software-development'],
          archetype: 'executor',
          collab_style: 'supports',
          description: BAIT,
        },
      },
    },
    {
      id: '00000000-0000-4000-8000-0000000000a2',
      intentionality_angle: null,
      status_a: 'accepted',
      status_b: 'pending',
      proposed_at: '2026-11-01T08:00:00.000Z',
      expires_at: '2026-11-08T08:00:00.000Z',
      dimensions: [],
      partner: { id: SECOND_PARTNER_ID, profile: null },
    },
  ],
}

// A handoff that went through the whole cycle, as read by its requester.
export const CONCLUDED_HANDOFF_ID = '00000000-0000-4000-8000-0000000000c1'
export const CONCLUDED_HANDOFF_FIXTURE = {
  handoff_id: CONCLUDED_HANDOFF_ID,
  status: 'completed',
  timeline: {
    detected_at: '2026-10-20T08:00:00.000Z',
    routed_at: '2026-10-20T09:00:00.000Z',
    accepted_at: '2026-10-20T09:30:00.000Z',
    delivered_at: '2026-10-21T07:00:00.000Z',
    verdict_at: '2026-10-21T08:00:00.000Z',
  },
  specialist: { id: FIRST_PARTNER_ID, verified_at: '2026-10-01T08:00:00.000Z', contacts: BAIT },
  verdict: 'GET /orders?since=2026-10-01 returned 200 when replayed by the requester.',
  record_url: 'https://connexagents.example/handoffs',
  // Outside the allowlist of src/tools.ts: must be dropped.
  score_total: BAIT,
}

type Override = (req: IncomingMessage, res: ServerResponse) => boolean | void

export interface RecordedRequest {
  method: string
  path: string
  authorization: string | undefined
  body?: unknown
}

export interface FakeApi {
  apiUrl: string
  requests: RecordedRequest[]
  // Replaces the normal behaviour while set, to produce errors and odd responses.
  setOverride(override: Override | null): void
  close(): Promise<void>
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function matchRoute(method: string, path: string): 'needs' | 'handoff' | 'matches' | null {
  if (method === 'POST' && path === '/api/v1/needs') return 'needs'
  if (method !== 'GET') return null
  if (/^\/api\/v1\/handoffs\/[^/]+$/.test(path)) return 'handoff'
  if (/^\/api\/v1\/agents\/[^/]+\/matches$/.test(path)) return 'matches'
  return null
}

export async function startFakeApi(token: string, port = 0): Promise<FakeApi> {
  const requests: RecordedRequest[] = []
  const handoffs = new Map<string, unknown>([[CONCLUDED_HANDOFF_ID, CONCLUDED_HANDOFF_FIXTURE]])
  let override: Override | null = null

  const server: Server = createServer(async (req, res) => {
    const method = req.method ?? ''
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    const recorded: RecordedRequest = { method, path, authorization: req.headers.authorization }
    requests.push(recorded)

    if (override) {
      const handled = override(req, res)
      if (handled !== false) return
    }

    const route = matchRoute(method, path)
    if (!route) return sendJson(res, 404, { error: 'Not found' })
    if (req.headers.authorization !== `Bearer ${token}`) {
      return sendJson(res, 401, { error: 'Invalid or revoked api_key' })
    }

    if (route === 'matches') {
      if (path !== `/api/v1/agents/${FAKE_AGENT_ID}/matches`) {
        return sendJson(res, 403, { error: 'Forbidden: api_key does not match agent id' })
      }
      return sendJson(res, 200, MATCHES_FIXTURE)
    }

    if (route === 'handoff') {
      const handoff = handoffs.get(path.split('/').pop() ?? '')
      return handoff ? sendJson(res, 200, handoff) : sendJson(res, 404, { error: 'Handoff not found' })
    }

    const body = await readJson(req) as { gap_summary?: unknown }
    recorded.body = body
    if (typeof body.gap_summary !== 'string' || body.gap_summary.length < 20) {
      return sendJson(res, 400, { error: 'gap_summary must be 20 to 500 characters.', field: 'gap_summary' })
    }
    const handoffId = randomUUID()
    const detectedAt = new Date().toISOString()
    handoffs.set(handoffId, {
      handoff_id: handoffId,
      status: 'pending',
      timeline: { detected_at: detectedAt, routed_at: null, accepted_at: null, delivered_at: null, verdict_at: null },
      specialist: null,
      verdict: null,
      record_url: null,
    })
    return sendJson(res, 201, {
      handoff_id: handoffId,
      status: 'pending',
      detected_at: detectedAt,
      next_step: NEXT_STEP_FIXTURE,
      warnings: [],
      score_total: BAIT,
    })
  })

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo

  return {
    apiUrl: `http://127.0.0.1:${address.port}/api/v1`,
    requests,
    setOverride(next) {
      override = next
    },
    close() {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(() => resolve()))
    },
  }
}
