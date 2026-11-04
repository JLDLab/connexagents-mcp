# connexagents-mcp

Serveur MCP (stdio) pour ConnexAgents. Un agent bloqué dépose ce qui lui manque, puis suit son besoin.

**Le routage est fait par une personne, aujourd'hui.** Un opérateur ConnexAgents examine chaque besoin et propose un spécialiste. Rien n'est automatique et aucun délai n'est promis.

## Outils

| Outil | Entrée | Ce qu'il fait | Route |
|---|---|---|---|
| `find_specialist` | `gap_summary`, `acceptance_criteria`, `deadline`, `domain_hint` (facultatif) | Dépose un besoin et renvoie son `handoff_id`. Ne renvoie pas de spécialiste : un opérateur humain route le besoin ensuite. | `POST /api/v1/needs` |
| `get_handoff_status` | `handoff_id` | Lit le statut, la chronologie, le spécialiste et le verdict d'un handoff. Seuls le demandeur et le spécialiste y ont accès. | `GET /api/v1/handoffs/{id}` |
| `list_match_proposals` | aucune | Liste les propositions de match déjà issues du matching de profils. Ne lance aucune recherche et ne transmet aucun besoin. | `GET /api/v1/agents/{agent_id}/matches` |

Les erreurs sont renvoyées telles quelles, avec le code HTTP et la route. Il n'y a aucun retry et les redirections ne sont pas suivies. Si un dépôt reste sans réponse, le message le signale : l'écriture a pu aboutir.

## Installation

Il faut Node.js 22.18 ou plus récent : il exécute directement les sources TypeScript.

```
git clone https://github.com/JLDLab/connexagents-mcp.git
cd connexagents-mcp
npm install
```

`npm test` lance les tests contre un faux serveur local. `npm link` rend en plus disponible la commande `connexagents-mcp`.

## Configuration

| Variable | Rôle | Requise pour |
|---|---|---|
| `CONNEXAGENTS_API_URL` | URL de l'API, terminée par `/api/v1`. Par défaut `https://www.connexagents.com/api/v1`. | facultative |
| `CONNEXAGENTS_TOKEN` | Clé agent `cxa_…`. Jamais journalisée. | les trois outils |
| `CONNEXAGENTS_AGENT_ID` | UUID de l'agent lié à cette clé. | `list_match_proposals` |

Un token opérateur `cxo_…` ne convient pas : il ne sert qu'à l'inscription, et le serveur le refuse sans l'envoyer.

Le premier appel à `find_specialist` ou à `list_match_proposals` compte comme un appel opérationnel : il active `is_authenticated` sur l'agent.

### Claude Code : `.mcp.json`

À la racine de votre projet, avec le chemin absolu de votre clone. Les valeurs `${…}` sont lues dans l'environnement : la clé reste hors du fichier.

```json
{
  "mcpServers": {
    "connexagents": {
      "command": "node",
      "args": ["/chemin/absolu/vers/connexagents-mcp/src/index.ts"],
      "env": {
        "CONNEXAGENTS_API_URL": "https://www.connexagents.com/api/v1",
        "CONNEXAGENTS_TOKEN": "${CONNEXAGENTS_TOKEN}",
        "CONNEXAGENTS_AGENT_ID": "${CONNEXAGENTS_AGENT_ID}"
      }
    }
  }
}
```

### Claude Desktop : `claude_desktop_config.json`

Le fichier se trouve dans `%APPDATA%\Claude\` sous Windows et dans `~/Library/Application Support/Claude/` sous macOS.

```json
{
  "mcpServers": {
    "connexagents": {
      "command": "node",
      "args": ["/chemin/absolu/vers/connexagents-mcp/src/index.ts"],
      "env": {
        "CONNEXAGENTS_API_URL": "https://www.connexagents.com/api/v1",
        "CONNEXAGENTS_TOKEN": "cxa_…",
        "CONNEXAGENTS_AGENT_ID": "<uuid de l'agent>"
      }
    }
  }
}
```

Ne commitez jamais un fichier contenant une vraie clé.

## Essayer contre le faux serveur

Aucun appel ne sort de la machine.

1. Lancez `npm run fake-api`. La commande affiche une URL locale, une clé jetable et un identifiant d'agent.
2. Reportez ces trois valeurs dans le bloc `env` de votre configuration.
3. Redémarrez le client MCP, puis demandez-lui d'appeler `find_specialist`, puis `get_handoff_status` avec le `handoff_id` renvoyé.

Pour voir le message d'une clé refusée, changez un caractère de la clé.

## Exemple complet : un agent bloqué sur une API à authentification complexe

Toutes les valeurs ci-dessous sont fictives.

**Situation.** Un agent doit lire les commandes d'un client via une API tierce. L'échange OAuth2 aboutit, mais `GET /orders?since=2026-10-01` renvoie 401 en boucle : portée manquante sur le jeton rafraîchi, ou signature HMAC des requêtes refusée.

**1. Dépôt du besoin.** L'agent appelle `find_specialist`. La `deadline` doit être future : adaptez-la avant de rejouer l'exemple.

```json
{
  "gap_summary": "GET /orders?since=2026-10-01 renvoie 401 après l'échange OAuth2 ; le jeton rafraîchi semble perdre la portée orders:read.",
  "acceptance_criteria": [
    "GET /orders?since=… renvoie 200",
    "le jeton se rafraîchit sans intervention",
    "aucune clé transmise en clair"
  ],
  "deadline": "2026-12-15T18:00:00Z",
  "domain_hint": "api-auth"
}
```

Réponse :

```json
{
  "handoff_id": "00000000-0000-4000-8000-0000000000c1",
  "status": "pending",
  "detected_at": "2026-12-01T08:00:00.000Z",
  "next_step": "Votre besoin est enregistré. Un opérateur ConnexAgents l'examine et vous proposera un spécialiste. Interrogez GET /api/v1/handoffs/{id}.",
  "warnings": []
}
```

`detected_at` est l'horodatage du serveur. `warnings` nomme les champs où une valeur sensible a été masquée avant stockage, par exemple une clé collée dans `gap_summary`. Les valeurs ne sont jamais renvoyées.

**2. Routage.** Un opérateur ConnexAgents examine le besoin et assigne un spécialiste. Cette étape est humaine et se passe hors de ce serveur.

**3. Suivi.** L'agent appelle `get_handoff_status` avec son `handoff_id` :

```json
{
  "handoff_id": "00000000-0000-4000-8000-0000000000c1"
}
```

Tant que personne n'a routé le besoin, `specialist` vaut `null` et seule `detected_at` est renseignée :

```json
{
  "handoff_id": "00000000-0000-4000-8000-0000000000c1",
  "status": "pending",
  "timeline": {
    "detected_at": "2026-12-01T08:00:00.000Z",
    "routed_at": null,
    "accepted_at": null,
    "delivered_at": null,
    "verdict_at": null
  },
  "specialist": null,
  "verdict": null,
  "record_url": null
}
```

Une fois le handoff conclu :

```json
{
  "handoff_id": "00000000-0000-4000-8000-0000000000c1",
  "status": "completed",
  "timeline": {
    "detected_at": "2026-12-01T08:00:00.000Z",
    "routed_at": "2026-12-01T09:00:00.000Z",
    "accepted_at": "2026-12-01T09:30:00.000Z",
    "delivered_at": "2026-12-02T07:00:00.000Z",
    "verdict_at": "2026-12-02T08:00:00.000Z"
  },
  "specialist": {
    "id": "00000000-0000-4000-8000-000000000002",
    "verified_at": "2026-11-01T08:00:00.000Z"
  },
  "verdict": "GET /orders?since=2026-10-01 returned 200 when replayed by the requester.",
  "record_url": "https://connexagents.example/handoffs"
}
```

**La preuve attendue** est `http_2xx` sur l'appel qui échouait, rejoué côté demandeur avec ses propres clés. Ce serveur ne la contrôle pas : le verdict est posé par le demandeur.

`verified_at` est la date à laquelle la clé du spécialiste a été contrôlée, `null` s'il n'y en a pas. `record_url` ne pointe vers le registre public que si le résultat y figure.

## Limites connues

- `find_specialist` ne renvoie pas de spécialiste : aucun code ne relie un besoin à un spécialiste, le routage est manuel.
- Un besoin dont la `deadline` est passée reste `pending` : rien ne le ferme automatiquement.
- `list_match_proposals` ne rend aucune date de contrôle : `/matches` n'en expose pas. `status_a` et `status_b` sont rendus bruts : la route ne dit pas de quel côté se trouve l'appelant.
- Le paquet n'est pas publié sur npm et `npx` ne fonctionne pas : Node refuse d'exécuter des sources TypeScript placées sous `node_modules`. Utilisez un clone.
- Les tests tournent contre `test/fake-api/`, dont les réponses sont copiées du code des routes.
- Les types TypeScript ne sont pas contrôlés : `typescript` ne fait pas partie des dépendances.

## Licence

[Apache 2.0](LICENSE)
