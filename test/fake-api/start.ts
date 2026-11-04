// Runs the fake API by hand, with a throwaway key generated at each start.
import { randomBytes } from 'node:crypto'
import { FAKE_AGENT_ID, startFakeApi } from './server.ts'

const token = `cxa_fake_${randomBytes(16).toString('hex')}`
const api = await startFakeApi(token, 4545)

console.log('Faux serveur local démarré. Clé jetable, valable pour ce serveur uniquement :')
console.log(JSON.stringify({
  CONNEXAGENTS_API_URL: api.apiUrl,
  CONNEXAGENTS_TOKEN: token,
  CONNEXAGENTS_AGENT_ID: FAKE_AGENT_ID,
}, null, 2))
console.log('Ctrl+C pour arrêter.')
