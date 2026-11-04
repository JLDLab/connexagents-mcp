// Appel réel, lancé à la main, à travers le vrai serveur MCP en stdio.
// ÉCRIT UNE LIGNE dans la base visée : un besoin de test, à marquer ensuite.
// Hors de `npm test` : ce fichier n'est pas un *.test.ts.
//
//   CONNEXAGENTS_API_URL=https://<déploiement>/api/v1 CONNEXAGENTS_TOKEN=cxa_… node test/real-call.ts
//
// L'URL n'a pas de valeur par défaut, pour ne jamais viser un site par accident.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const apiUrl = process.env.CONNEXAGENTS_API_URL?.trim()
const token = process.env.CONNEXAGENTS_TOKEN?.trim()
if (!apiUrl || !token) {
  console.error('CONNEXAGENTS_API_URL et CONNEXAGENTS_TOKEN sont requis. Aucun appel envoyé.')
  process.exit(1)
}

const NEED = {
  gap_summary: "[TEST ConnexAgents] GET /orders?since=2026-10-01 renvoie 401 après l'échange OAuth2 ; le jeton rafraîchi semble perdre la portée orders:read.",
  acceptance_criteria: ['GET /orders?since=… renvoie 200', 'le jeton se rafraîchit sans intervention', 'aucune clé transmise en clair'],
  deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  domain_hint: 'api-auth',
}

async function withClient<T>(key: string, run: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['src/index.ts'],
    env: { CONNEXAGENTS_API_URL: apiUrl!, CONNEXAGENTS_TOKEN: key, PATH: process.env.PATH ?? '' },
  })
  const client = new Client({ name: 'real-call', version: '0.0.0' })
  await client.connect(transport)
  try {
    return await run(client)
  } finally {
    await client.close()
  }
}

type ToolResponse = { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, any> }

function show(title: string, response: ToolResponse): void {
  console.log(`\n--- ${title}${response.isError ? ' (erreur)' : ''}`)
  console.log(response.content[0]?.text)
}

await withClient(token, async (client) => {
  const need = await client.callTool({ name: 'find_specialist', arguments: NEED }) as ToolResponse
  show('find_specialist : POST /api/v1/needs', need)

  const handoffId = need.structuredContent?.handoff_id
  if (typeof handoffId === 'string') {
    show('get_handoff_status : GET /api/v1/handoffs/{id}', await client.callTool({
      name: 'get_handoff_status',
      arguments: { handoff_id: handoffId },
    }) as ToolResponse)
  }

  show('id inconnu : 404 attendu', await client.callTool({
    name: 'get_handoff_status',
    arguments: { handoff_id: '00000000-0000-4000-8000-000000000000' },
  }) as ToolResponse)

  if (typeof handoffId === 'string') {
    console.log(`\nBesoin de test créé, à signaler à un opérateur : ${handoffId}`)
  }
})

await withClient('cxa_cle_volontairement_invalide', async (client) => {
  show('clé invalide : 401 attendu, aucune écriture', await client.callTool({
    name: 'get_handoff_status',
    arguments: { handoff_id: '00000000-0000-4000-8000-000000000000' },
  }) as ToolResponse)
})
