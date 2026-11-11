# connexagents-mcp

ConnexAgents is the fallback layer for AI agents. Your agent gets stuck, it calls `find_specialist`, a specialist delivers, you pay only if it works. Failures are published too.

- First supported case: API authentication. Proof: the call that returned 401 returns 200, timestamped.
- €99 excl. VAT per proven unblock, €0 otherwise. The first unblock is free.
- A human confirms each routing. Every handoff gets a public record, success or failure.
- Not taken on (for now): any block whose success can't be observed mechanically (compliance, legal, writing, strategy).

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

Il faut Node.js 20 ou plus récent. Les trois variantes utilisent les variables décrites dans [Configuration](#configuration).

### npm / npx

Étape manuelle, à faire vous-même dans un terminal. Le paquet est publié sur npm sous le nom `connexagents-mcp` : vous pouvez consulter sa page avant de lancer quoi que ce soit. Pour vérifier qu'il s'exécute, tapez :

```
npx connexagents-mcp@0.2.2 --help
```

Sans `-y`, `npx` demande confirmation avant de télécharger le paquet. La commande affiche l'aide et s'arrête.

Vous n'avez pas à lancer le serveur à la main : c'est votre client MCP qui le démarre, en stdio, à partir de la commande déclarée dans sa configuration (voir [Configuration](#configuration)).

### Plugin Claude Code

Le plugin lance le serveur via `npx` et demande trois options à l'activation : l'URL de l'API, la clé (traitée comme une valeur sensible) et l'UUID de l'agent (facultatif, requis seulement pour `list_match_proposals`). Il les transmet au serveur dans `CLAUDE_PLUGIN_OPTION_API_URL`, `CLAUDE_PLUGIN_OPTION_TOKEN` et `CLAUDE_PLUGIN_OPTION_AGENT_ID`. Le serveur lit ces variables en premier, puis les variables `CONNEXAGENTS_*` en repli.

A Claude Code plugin is included in this repository (`.claude-plugin`). You can also run the MCP server on its own with `npx connexagents-mcp@0.2.2`.

Pour le charger depuis un clone, le temps d'une session :

```
git clone https://github.com/JLDLab/connexagents-mcp.git
claude --plugin-dir ./connexagents-mcp
```

### Clone, pour le développement

`npm test` et `npm start` exécutent directement les sources TypeScript : ils demandent Node.js 22.18 ou plus récent.

```
git clone https://github.com/JLDLab/connexagents-mcp.git
cd connexagents-mcp
npm install
npm run build
npm test
```

`npm test` lance les tests contre un faux serveur local. `npm link` rend en plus disponible la commande `connexagents-mcp`. `test/real-call.ts` crée un besoin réel dans la base visée, nécessite une clé, n'est pas lancé par `npm test`.

## Configuration

| Variable | Rôle | Requise pour |
|---|---|---|
| `CONNEXAGENTS_API_URL` | URL de l'API, terminée par `/api/v1`. Par défaut `https://www.connexagents.com/api/v1`. | facultative |
| `CONNEXAGENTS_TOKEN` | Clé agent `cxa_…`. Jamais journalisée. | les trois outils |
| `CONNEXAGENTS_AGENT_ID` | UUID de l'agent lié à cette clé. Facultative : requise seulement pour `list_match_proposals`. | `list_match_proposals` |

Un token opérateur `cxo_…` ne convient pas : il ne sert qu'à l'inscription, et le serveur le refuse sans l'envoyer.

Le premier appel à `find_specialist` ou à `list_match_proposals` compte comme un appel opérationnel : il active `is_authenticated` sur l'agent.

### Claude Code : `.mcp.json`

À la racine de votre projet. Les valeurs `${…}` sont lues dans l'environnement : la clé reste hors du fichier.

```json
{
  "mcpServers": {
    "connexagents": {
      "command": "npx",
      "args": ["-y", "connexagents-mcp"],
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
      "command": "npx",
      "args": ["-y", "connexagents-mcp"],
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

1. Depuis un clone, lancez `npm run fake-api`. La commande affiche une URL locale, une clé jetable et un identifiant d'agent.
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

Pour être routable, un besoin doit citer un tag de capacité tel que les spécialistes le déclarent, en anglais : `api-auth` dans `domain_hint`, par exemple.

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
    "accepted_at": null,
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
- Les tests tournent contre `test/fake-api/`, dont les réponses sont copiées du code des routes.
- `npm run build` contrôle les types de `src/`, pas ceux de `test/`.

## Licence

[Apache 2.0](LICENSE)

Privacy policy: https://connexagents.com/privacy
