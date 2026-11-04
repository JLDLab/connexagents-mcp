import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { after, afterEach, before, describe, it } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ConfigError, DEFAULT_API_URL, loadConfig } from '../src/config.ts'
import type { Config } from '../src/config.ts'
import { createServer } from '../src/server.ts'
import { BAIT, CONCLUDED_HANDOFF_FIXTURE, CONCLUDED_HANDOFF_ID, FAKE_AGENT_ID, MATCHES_FIXTURE, NEXT_STEP_FIXTURE, matchRoute, startFakeApi } from './fake-api/server.ts'
import type { FakeApi } from './fake-api/server.ts'

// Generated at each run: no key is written in the test files.
const TOKEN = `cxa_${randomBytes(32).toString('hex')}`

const NEED = {
  gap_summary: 'GET /orders?since=2026-10-01 renvoie 401 après échange OAuth2.',
  acceptance_criteria: ['GET /orders?since=… renvoie 200'],
  deadline: '2026-11-20T18:00:00Z',
}

type ToolResponse = {
  isError?: boolean
  content: { type: string; text: string }[]
  structuredContent?: Record<string, any>
}

async function callWith(config: Partial<Config>, api: FakeApi, name: string, args: Record<string, unknown> = {}) {
  const server = createServer({ apiUrl: api.apiUrl, token: TOKEN, agentId: FAKE_AGENT_ID, timeoutMs: 10_000, ...config })
  const client = new Client({ name: 'test', version: '0.0.0' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  try {
    return await client.callTool({ name, arguments: args }) as ToolResponse
  } finally {
    await client.close()
  }
}

function respondWith(api: FakeApi, status: number, body: unknown) {
  api.setOverride((_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
}

describe('connexagents-mcp', () => {
  let api: FakeApi

  before(async () => {
    api = await startFakeApi(TOKEN)
  })
  afterEach(() => {
    api.setOverride(null)
    api.requests.length = 0
  })
  after(() => api.close())

  describe('de bout en bout, en stdio', () => {
    it('dépôt du besoin puis lecture du statut, sans secret dans la sortie', async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['src/index.ts'],
        env: {
          CONNEXAGENTS_API_URL: api.apiUrl,
          CONNEXAGENTS_TOKEN: TOKEN,
          PATH: process.env.PATH ?? '',
        },
        stderr: 'pipe',
      })
      let stderr = ''
      transport.stderr?.on('data', (chunk) => { stderr += String(chunk) })
      const client = new Client({ name: 'test', version: '0.0.0' })
      await client.connect(transport)
      try {
        const { tools } = await client.listTools()
        assert.deepEqual(tools.map((tool) => tool.name).sort(), ['find_specialist', 'get_handoff_status', 'list_match_proposals'])

        const need = await client.callTool({ name: 'find_specialist', arguments: NEED }) as ToolResponse
        assert.equal(need.isError, undefined)
        assert.equal(need.structuredContent?.status, 'pending')

        const status = await client.callTool({
          name: 'get_handoff_status',
          arguments: { handoff_id: need.structuredContent?.handoff_id },
        }) as ToolResponse
        assert.equal(status.structuredContent?.handoff_id, need.structuredContent?.handoff_id)
        assert.equal(status.structuredContent?.status, 'pending')
        assert.equal(status.structuredContent?.timeline.detected_at, need.structuredContent?.detected_at)
        assert.equal(status.structuredContent?.specialist, null)

        assert.ok(!JSON.stringify([tools, need, status]).includes(TOKEN))
      } finally {
        await client.close()
      }
      assert.ok(!stderr.includes(TOKEN), 'le token ne doit pas apparaître sur stderr')
    })
  })

  describe('find_specialist', () => {
    it('poste le besoin sur POST /api/v1/needs et rend le contrat, sans score', async () => {
      const response = await callWith({ agentId: undefined }, api, 'find_specialist', { ...NEED, domain_hint: 'api-auth' })
      assert.equal(response.isError, undefined)
      assert.equal(api.requests.length, 1)
      assert.equal(api.requests[0].method, 'POST')
      assert.equal(api.requests[0].path, '/api/v1/needs')
      assert.equal(api.requests[0].authorization, `Bearer ${TOKEN}`)
      assert.deepEqual(api.requests[0].body, { ...NEED, domain_hint: 'api-auth' })

      const out = response.structuredContent
      assert.deepEqual(Object.keys(out ?? {}).sort(), ['detected_at', 'handoff_id', 'next_step', 'status', 'warnings'])
      assert.equal(out?.status, 'pending')
      assert.equal(out?.next_step, NEXT_STEP_FIXTURE)
      assert.deepEqual(out?.warnings, [])
      assert.ok(!JSON.stringify(response).includes(BAIT))
    })

    it('n\'envoie jamais de detected_at fourni par le client', async () => {
      await callWith({}, api, 'find_specialist', { ...NEED, detected_at: '2020-01-01T00:00:00Z' })
      assert.ok(!('detected_at' in (api.requests[0].body as object)))
    })

    it('champ requis absent ou aucun critère : refusé par le schéma, aucun appel réseau', async () => {
      for (const args of [{}, { ...NEED, acceptance_criteria: [] }, { ...NEED, deadline: undefined }]) {
        const response = await callWith({}, api, 'find_specialist', args)
        assert.equal(response.isError, true)
      }
      assert.equal(api.requests.length, 0)
    })

    it('400 : relaie le message de validation de l\'API', async () => {
      const response = await callWith({}, api, 'find_specialist', { ...NEED, gap_summary: 'trop court' })
      assert.equal(response.content[0].text, 'Erreur API : HTTP 400 sur POST /api/v1/needs : gap_summary must be 20 to 500 characters..')
    })

    it('429 : relaie la limite, un seul appel', async () => {
      respondWith(api, 429, { error: 'Too many open needs: an agent can have at most 5 at a time.', max_open_needs: 5 })
      const response = await callWith({}, api, 'find_specialist', NEED)
      assert.match(response.content[0].text, /HTTP 429 sur POST \/api\/v1\/needs : Too many open needs/)
      assert.equal(api.requests.length, 1)
    })

    it('401 : message attendu, sans le token', async () => {
      const response = await callWith({ token: 'cxa_wrong' }, api, 'find_specialist', NEED)
      assert.equal(response.content[0].text, 'token opérateur manquant ou invalide (HTTP 401 sur POST /api/v1/needs).')
    })

    it('token cxo_ ou absent : aucun appel réseau', async () => {
      assert.match((await callWith({ token: 'cxo_abc123' }, api, 'find_specialist', NEED)).content[0].text, /attend une clé agent cxa_/)
      assert.match((await callWith({ token: undefined }, api, 'find_specialist', NEED)).content[0].text, /CONNEXAGENTS_TOKEN est absent/)
      assert.equal(api.requests.length, 0)
    })

    it('timeout : signale que l\'écriture a pu aboutir, sans nouvel essai', async () => {
      api.setOverride(() => true) // never answers
      const response = await callWith({ timeoutMs: 50 }, api, 'find_specialist', NEED)
      assert.match(response.content[0].text, /Aucune nouvelle tentative\. L'écriture a pu aboutir/)
      assert.equal(api.requests.length, 1)
    })

    it('réponse de forme inattendue : erreur lisible', async () => {
      respondWith(api, 201, { handoff_id: 1 })
      assert.match((await callWith({}, api, 'find_specialist', NEED)).content[0].text, /Réponse inattendue sur POST \/api\/v1\/needs/)
    })
  })

  describe('list_match_proposals', () => {
    it('renvoie les propositions dans l\'ordre de la route, champs autorisés seulement', async () => {
      const { structuredContent: out } = await callWith({}, api, 'list_match_proposals')
      assert.deepEqual(Object.keys(out ?? {}).sort(), ['next_step', 'proposals', 'status'])
      assert.deepEqual(out?.proposals.map((p: any) => p.match_id), MATCHES_FIXTURE.matches.map((m) => m.id))
      assert.deepEqual(out?.proposals[0], {
        match_id: MATCHES_FIXTURE.matches[0].id,
        intentionality_angle: MATCHES_FIXTURE.matches[0].intentionality_angle,
        status_a: 'pending',
        status_b: 'pending',
        proposed_at: MATCHES_FIXTURE.matches[0].proposed_at,
        expires_at: MATCHES_FIXTURE.matches[0].expires_at,
        specialist: {
          id: MATCHES_FIXTURE.matches[0].partner.id,
          profile: {
            display_name: 'Fictional OAuth Specialist',
            capabilities_tags: ['api-integration', 'automation', 'software-development'],
            archetype: 'executor',
            collab_style: 'supports',
          },
        },
      })
      assert.equal(out?.proposals[1].specialist.profile, null)
    })

    it('ne laisse passer ni score, ni dimensions, ni contact', async () => {
      const response = await callWith({}, api, 'list_match_proposals')
      const serialized = JSON.stringify(response)
      assert.ok(!serialized.includes(BAIT))
      assert.ok(!/score|dimensions|contacts/i.test(serialized))
    })

    it('dit clairement qu\'aucune recherche n\'a eu lieu et qu\'aucun handoff n\'a été créé', async () => {
      const { structuredContent: out } = await callWith({}, api, 'list_match_proposals')
      assert.match(out?.next_step, /Aucune recherche lancée, aucun besoin transmis, aucun handoff créé/)
      assert.ok(!('handoff_id' in (out ?? {})))
    })

    it('n\'envoie aucun champ de besoin à l\'API', async () => {
      await callWith({}, api, 'list_match_proposals', { gap_summary: 'une description du blocage rencontré' })
      assert.equal(api.requests.length, 1)
      assert.equal(api.requests[0].method, 'GET')
    })

    it('liste vide : no_proposal', async () => {
      respondWith(api, 200, { agent_id: FAKE_AGENT_ID, total: 0, matches: [] })
      const { structuredContent: out } = await callWith({}, api, 'list_match_proposals')
      assert.equal(out?.status, 'no_proposal')
      assert.deepEqual(out?.proposals, [])
    })

    it('401 : message attendu, avec code et route, sans le token', async () => {
      const response = await callWith({ token: 'cxa_wrong' }, api, 'list_match_proposals')
      assert.equal(response.isError, true)
      assert.equal(
        response.content[0].text,
        'token opérateur manquant ou invalide (HTTP 401 sur GET /api/v1/agents/{agent_id}/matches).',
      )
      assert.ok(!response.content[0].text.includes('cxa_wrong'))
    })

    it('500 : code et route, et le token renvoyé par l\'API est masqué', async () => {
      respondWith(api, 500, { error: `boom ${TOKEN} cxo_abc123` })
      const response = await callWith({}, api, 'list_match_proposals')
      assert.equal(response.isError, true)
      assert.equal(response.content[0].text, 'Erreur API : HTTP 500 sur GET /api/v1/agents/{agent_id}/matches : boom [masqué] [masqué].')
    })

    it('403 : relaie le statut et le message de la route', async () => {
      const response = await callWith({ agentId: '00000000-0000-4000-8000-0000000000ff' }, api, 'list_match_proposals')
      assert.match(response.content[0].text, /HTTP 403 sur GET .*Forbidden: api_key does not match agent id/)
    })

    it('un seul appel en cas d\'erreur : pas de retry', async () => {
      respondWith(api, 503, {})
      await callWith({}, api, 'list_match_proposals')
      assert.equal(api.requests.length, 1)
    })

    it('token absent : aucun appel réseau', async () => {
      const response = await callWith({ token: undefined }, api, 'list_match_proposals')
      assert.equal(response.isError, true)
      assert.match(response.content[0].text, /^token opérateur manquant ou invalide/)
      assert.equal(api.requests.length, 0)
    })

    it('token cxo_ : refusé localement, jamais envoyé', async () => {
      const value = `cxo_${randomBytes(8).toString('hex')}`
      const response = await callWith({ token: value }, api, 'list_match_proposals')
      assert.equal(response.isError, true)
      assert.match(response.content[0].text, /attend une clé agent cxa_/)
      assert.ok(!response.content[0].text.includes(value))
      assert.equal(api.requests.length, 0)
    })

    it('token avec retour à la ligne : refusé localement, sans l\'afficher', async () => {
      const response = await callWith({ token: 'cxa_abc\nInjected: 1' }, api, 'list_match_proposals')
      assert.equal(response.isError, true)
      assert.ok(!response.content[0].text.includes('cxa_abc'))
      assert.equal(api.requests.length, 0)
    })

    it('agent_id absent ou invalide : aucun appel réseau', async () => {
      for (const agentId of [undefined, '../../admin/claims']) {
        const response = await callWith({ agentId }, api, 'list_match_proposals')
        assert.match(response.content[0].text, /CONNEXAGENTS_AGENT_ID/)
      }
      assert.equal(api.requests.length, 0)
    })

    it('timeout : message lisible, un seul appel', async () => {
      api.setOverride(() => true) // never answers
      const response = await callWith({ timeoutMs: 50 }, api, 'list_match_proposals')
      assert.equal(response.isError, true)
      assert.match(response.content[0].text, /Délai de 0\.05 s dépassé sur GET .*Aucune nouvelle tentative/)
      assert.equal(api.requests.length, 1)
    })

    it('serveur injoignable : message sans détail brut', async () => {
      const closed = await startFakeApi(TOKEN)
      const apiUrl = closed.apiUrl
      await closed.close()
      const response = await callWith({ apiUrl }, api, 'list_match_proposals')
      assert.equal(response.isError, true)
      assert.match(response.content[0].text, /^Appel impossible sur GET \/api\/v1\/agents\/\{agent_id\}\/matches/)
      assert.ok(!response.content[0].text.includes(TOKEN))
    })

    it('redirection : signalée, jamais suivie', async () => {
      api.setOverride((req, res) => {
        res.writeHead(302, { Location: `${api.apiUrl}/elsewhere` })
        res.end()
      })
      const response = await callWith({}, api, 'list_match_proposals')
      assert.match(response.content[0].text, /HTTP 302/)
      assert.equal(api.requests.length, 1)
    })

    it('2xx non JSON, ou de forme inattendue : erreur lisible', async () => {
      respondWith(api, 200, '<html></html>')
      assert.match((await callWith({}, api, 'list_match_proposals')).content[0].text, /Réponse illisible/)
      respondWith(api, 200, { matches: [{ id: 1 }] })
      assert.match((await callWith({}, api, 'list_match_proposals')).content[0].text, /Réponse inattendue/)
    })
  })

  describe('get_handoff_status', () => {
    it('lit le handoff par id avec le token, champs du contrat seulement', async () => {
      const response = await callWith({ agentId: undefined }, api, 'get_handoff_status', { handoff_id: CONCLUDED_HANDOFF_ID })
      assert.equal(api.requests[0].path, `/api/v1/handoffs/${CONCLUDED_HANDOFF_ID}`)
      assert.equal(api.requests[0].authorization, `Bearer ${TOKEN}`)
      const { specialist, score_total: _score, ...rest } = CONCLUDED_HANDOFF_FIXTURE
      assert.deepEqual(response.structuredContent, {
        ...rest,
        specialist: { id: specialist.id, verified_at: specialist.verified_at },
      })
      assert.ok(!JSON.stringify(response).includes(BAIT))
    })

    it('404 : relayé tel quel, pour un id inconnu', async () => {
      const response = await callWith({}, api, 'get_handoff_status', { handoff_id: '00000000-0000-4000-8000-0000000000ee' })
      assert.equal(response.isError, true)
      assert.equal(response.content[0].text, 'Erreur API : HTTP 404 sur GET /api/v1/handoffs/{id} : Handoff not found.')
    })

    it('id qui n\'est pas un UUID : refusé par le schéma, aucun appel réseau', async () => {
      const response = await callWith({}, api, 'get_handoff_status', { handoff_id: '../../admin/claims' })
      assert.equal(response.isError, true)
      assert.equal(api.requests.length, 0)
    })

    it('token absent : aucun appel réseau', async () => {
      const response = await callWith({ token: undefined }, api, 'get_handoff_status', { handoff_id: CONCLUDED_HANDOFF_ID })
      assert.match(response.content[0].text, /CONNEXAGENTS_TOKEN est absent/)
      assert.equal(api.requests.length, 0)
    })

    it('un seul appel en cas d\'erreur, sans mention d\'écriture', async () => {
      respondWith(api, 503, {})
      const response = await callWith({}, api, 'get_handoff_status', { handoff_id: CONCLUDED_HANDOFF_ID })
      assert.equal(api.requests.length, 1)
      assert.ok(!response.content[0].text.includes('écriture'))
    })
  })

  describe('configuration', () => {
    it('applique les valeurs par défaut', () => {
      const config = loadConfig({})
      assert.equal(config.apiUrl, DEFAULT_API_URL)
      assert.equal(config.token, undefined)
      assert.equal(config.timeoutMs, 10_000)
    })

    it('normalise la barre finale', () => {
      assert.equal(loadConfig({ CONNEXAGENTS_API_URL: 'http://localhost:4545/api/v1/' }).apiUrl, 'http://localhost:4545/api/v1')
    })

    it('refuse les URL dangereuses ou inutilisables, sans les afficher', () => {
      const secret = 'hunter2'
      for (const url of [
        'pas une url',
        'http://example.test/api/v1',
        `https://user:${secret}@example.test/api/v1`,
        'https://example.test/api',
        'https://example.test/api/v1?x=1',
        'file:///api/v1',
      ]) {
        assert.throws(() => loadConfig({ CONNEXAGENTS_API_URL: url }), (err: Error) => {
          assert.ok(err instanceof ConfigError)
          assert.ok(!err.message.includes(secret))
          return true
        })
      }
    })
  })

  describe('garde-fous du dépôt', () => {
    const readme = readFileSync('README.md', 'utf8')
    const sources = readdirSync('src').map((file) => readFileSync(`src/${file}`, 'utf8')).join('\n')

    it('chaque appel réseau correspond à une route du README', async () => {
      await callWith({}, api, 'find_specialist', NEED)
      await callWith({}, api, 'get_handoff_status', { handoff_id: CONCLUDED_HANDOFF_ID })
      await callWith({}, api, 'list_match_proposals')
      assert.equal(api.requests.length, 3)
      for (const { method, path } of api.requests) {
        assert.notEqual(matchRoute(method, path), null, `${method} ${path}`)
      }
      assert.ok(readme.includes('`POST /api/v1/needs`'))
      assert.ok(readme.includes('`GET /api/v1/handoffs/{id}`'))
      assert.ok(readme.includes('`GET /api/v1/agents/{agent_id}/matches`'))
    })

    it('les entrées des outils sont celles du contrat', async () => {
      const server = createServer({ apiUrl: api.apiUrl, token: TOKEN, agentId: FAKE_AGENT_ID, timeoutMs: 10_000 })
      const client = new Client({ name: 'test', version: '0.0.0' })
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
      await Promise.all([server.connect(serverSide), client.connect(clientSide)])
      const { tools } = await client.listTools()
      await client.close()
      const inputs = (name: string) => tools.find((tool) => tool.name === name)?.inputSchema
      assert.deepEqual(Object.keys(inputs('find_specialist')?.properties ?? {}).sort(), ['acceptance_criteria', 'deadline', 'domain_hint', 'gap_summary'])
      assert.deepEqual([...(inputs('find_specialist')?.required ?? [])].sort(), ['acceptance_criteria', 'deadline', 'gap_summary'])
      assert.deepEqual(Object.keys(inputs('get_handoff_status')?.properties ?? {}), ['handoff_id'])
      assert.deepEqual(Object.keys(inputs('list_match_proposals')?.properties ?? {}), [])
    })

    it('le code n\'emploie aucune formule interdite', () => {
      // verified_at est un champ daté du contrat de l'API, seul emploi admis.
      assert.ok(!/A2A-ready|certifi|verified|vérifié/i.test(sources.replaceAll('verified_at', '')))
    })

    it('seules les deux dépendances autorisées sont déclarées', () => {
      const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
      assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@modelcontextprotocol/sdk', 'zod'])
      assert.equal(pkg.devDependencies, undefined)
    })
  })
})
