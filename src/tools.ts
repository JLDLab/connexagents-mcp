import { z } from 'zod'
import { getJson, postJson, UNAUTHORIZED_MESSAGE } from './api.ts'
import type { Config } from './config.ts'

export type ToolResult = { ok: true; value: Record<string, unknown> } | { ok: false; message: string }

export const NEEDS_ROUTE = 'POST /api/v1/needs'
export const HANDOFF_ROUTE = 'GET /api/v1/handoffs/{id}'
export const MATCHES_ROUTE = 'GET /api/v1/agents/{agent_id}/matches'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SENDABLE_TOKEN = /^[\x21-\x7e]+$/

const nullableText = z.string().nullable()

// Only the fields named here can reach a tool response.
const needResponse = z.object({
  handoff_id: z.string(),
  status: z.string(),
  detected_at: z.string(),
  next_step: z.string(),
  warnings: z.array(z.string()),
})

const handoffResponse = z.object({
  handoff_id: z.string(),
  status: z.string(),
  timeline: z.object({
    detected_at: nullableText,
    routed_at: nullableText,
    accepted_at: nullableText,
    delivered_at: nullableText,
    verdict_at: nullableText,
  }),
  specialist: z.object({ id: z.string(), verified_at: nullableText }).nullable(),
  verdict: nullableText,
  record_url: nullableText,
})

// `dimensions` is left out on purpose: tool responses carry no score.
const matchesResponse = z.object({
  matches: z.array(z.object({
    id: z.string(),
    intentionality_angle: nullableText,
    status_a: z.string(),
    status_b: z.string(),
    proposed_at: z.string(),
    expires_at: z.string(),
    partner: z.object({
      id: z.string().optional(),
      profile: z.object({
        display_name: nullableText,
        capabilities_tags: z.array(z.string()).nullable(),
        archetype: nullableText,
        collab_style: nullableText,
      }).nullable(),
    }),
  })),
})

function unexpectedShape(route: string): ToolResult {
  return { ok: false, message: `Réponse inattendue sur ${route} : forme différente de celle attendue par ce serveur.` }
}

// Returns the reason no call can be sent, or null when the token is usable.
function tokenProblem(token: string | undefined, route: string): string | null {
  if (!token) {
    return `${UNAUTHORIZED_MESSAGE} : CONNEXAGENTS_TOKEN est absent. Aucun appel envoyé.`
  }
  if (token.startsWith('cxo_')) {
    return `${UNAUTHORIZED_MESSAGE} : un token cxo_ ne sert qu'à l'inscription (POST /api/v1/agents/register). ${route} attend une clé agent cxa_. Aucun appel envoyé.`
  }
  if (!SENDABLE_TOKEN.test(token)) {
    return `${UNAUTHORIZED_MESSAGE} : CONNEXAGENTS_TOKEN contient des caractères non autorisés. Aucun appel envoyé.`
  }
  return null
}

export interface NeedInput {
  gap_summary: string
  acceptance_criteria: string[]
  deadline: string
  domain_hint?: string
}

export async function findSpecialist(config: Config, need: NeedInput): Promise<ToolResult> {
  const problem = tokenProblem(config.token, NEEDS_ROUTE)
  if (problem) return { ok: false, message: problem }

  const result = await postJson(
    { url: `${config.apiUrl}/needs`, route: NEEDS_ROUTE, token: config.token, timeoutMs: config.timeoutMs },
    need,
  )
  if (!result.ok) return result

  const parsed = needResponse.safeParse(result.data)
  if (!parsed.success) return unexpectedShape(NEEDS_ROUTE)
  return { ok: true, value: parsed.data }
}

export async function getHandoffStatus(config: Config, handoffId: string): Promise<ToolResult> {
  const problem = tokenProblem(config.token, HANDOFF_ROUTE)
  if (problem) return { ok: false, message: problem }

  const result = await getJson({
    url: `${config.apiUrl}/handoffs/${encodeURIComponent(handoffId)}`,
    route: HANDOFF_ROUTE,
    token: config.token,
    timeoutMs: config.timeoutMs,
  })
  if (!result.ok) return result

  const parsed = handoffResponse.safeParse(result.data)
  if (!parsed.success) return unexpectedShape(HANDOFF_ROUTE)
  return { ok: true, value: parsed.data }
}

export async function listMatchProposals(config: Config): Promise<ToolResult> {
  const { token, agentId } = config
  const problem = tokenProblem(token, MATCHES_ROUTE)
  if (problem) return { ok: false, message: problem }
  if (!agentId || !UUID.test(agentId)) {
    return { ok: false, message: "CONNEXAGENTS_AGENT_ID est absent ou n'est pas un UUID. Aucun appel envoyé." }
  }

  const result = await getJson({
    url: `${config.apiUrl}/agents/${encodeURIComponent(agentId)}/matches`,
    route: MATCHES_ROUTE,
    token,
    timeoutMs: config.timeoutMs,
  })
  if (!result.ok) return result

  const parsed = matchesResponse.safeParse(result.data)
  if (!parsed.success) return unexpectedShape(MATCHES_ROUTE)

  const proposals = parsed.data.matches.map((match) => ({
    match_id: match.id,
    intentionality_angle: match.intentionality_angle,
    status_a: match.status_a,
    status_b: match.status_b,
    proposed_at: match.proposed_at,
    expires_at: match.expires_at,
    specialist: { id: match.partner.id ?? null, profile: match.partner.profile },
  }))

  return {
    ok: true,
    value: {
      status: proposals.length > 0 ? 'proposals_listed' : 'no_proposal',
      proposals,
      next_step: proposals.length > 0
        ? "Propositions issues du matching de profils, dans l'ordre de l'API. Aucune recherche lancée, aucun besoin transmis, aucun handoff créé. Accepter une proposition et ouvrir un handoff se fait hors de ce serveur."
        : 'Aucune proposition en cours pour cet agent. Pour transmettre un besoin précis, appelez find_specialist.',
    },
  }
}
