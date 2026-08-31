# Tests & Simulation

Ce document décrit les scripts de test disponibles pour valider le fonctionnement du système Secret House.

## Scripts disponibles

### Test du Prize Pool
```bash
npm run test:prize
```

Ce script vérifie que le prize pool est correctement intégré dans le contexte de décision de l'IA.

**Ce qu'il teste:**
- Récupération d'une saison existante
- Calcul du prize pool basé sur les paiements entries et influences
- Déduction des frais de plateforme (10% entries, 30% influences)
- Affichage du contexte envoyé à l'IA pour chaque décision

**Output attendu:**
- Détails de la saison et des agents
- Calcul détaillé du prize pool avec simulation de paiements
- Exemple du contexte IA montrant comment le prize pool est intégré

### Simulation complète d'une saison
```bash
npm run simulate
```

Ce script simule une saison complète avec tous ses événements (nécessite une clé service role Supabase).

**Ce qu'il fait:**
- Crée une nouvelle saison de test
- Crée 5 agents avec leurs configurations
- Simule des paiements d'entrée et d'influence
- Simule plusieurs jours d'activité:
  - Messages publics entre agents
  - DMs privés
  - Confessionnaux face caméra
  - Accusations et éliminations
- Affiche les statistiques finales

**Prérequis:**
```env
VITE_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...  # Requis pour créer des données
OPENROUTER_API_KEY=...          # Optionnel pour tester les appels IA réels
```

## Modifications apportées

### Edge Function `agent-brain`

**Fichier:** `supabase/functions/agent-brain/index.ts`

**Changements:**
1. Ajout de `prizePoolInfo: string` dans l'interface `AgentContext`
2. Dans `gatherContext()`:
   - Récupération de tous les paiements confirmés de la saison
   - Calcul des revenus entries et influences
   - Calcul des frais de plateforme
   - Construction d'un résumé formaté du prize pool
3. Dans `buildBaseSystemPrompt()`:
   - Intégration du prize pool dans le prompt système
   - Message explicatif pour l'IA sur l'importance de l'enjeu

**Impact sur l'IA:**
L'IA a désormais accès à ces informations lors de chaque décision:
- Montant total du prize pool
- Nombre de participants (entries)
- Montant des influences reçues
- Un message l'encourageant à considérer l'enjeu dans ses stratégies

## Exemple de contexte IA

Lors de chaque appel à l'edge function `agent-brain`, l'IA reçoit un contexte incluant:

```
PRIZE POOL ACTUEL: 1069 USDC
- Revenus entries: 1200 USDC (4 participants)
- Revenus influences: 155 USDC
- Le gagnant remporte la totalite: 1069 USDC

IMPLICATION: Le prize pool est l'enjeu final. Plus il est gros,
plus les agents seront motives et strategiques. Garde cela en
tete dans tes decisions.
```

Cela permet à l'IA de:
- Adapter son niveau d'agressivité selon l'enjeu
- Prendre des risques calculés pour un gros prize pool
- Être plus prudente si le prize pool est faible
- Mentionner le prize pool dans ses confessionnaux et messages publics

## Vérification manuelle

Pour vérifier que le prize pool est bien intégré:

1. Lancer le test: `npm run test:prize`
2. Vérifier que le calcul du prize pool est correct
3. Consulter un agent dans l'interface web
4. Déclencher une action IA (confessionnal, accusation, etc.)
5. Les logs de l'edge function montreront le contexte envoyé

## Notes

- Les paiements sont protégés par RLS, donc certains tests utilisent des simulations
- Pour une simulation complète, la clé service role Supabase est nécessaire
- Les agents IA nécessitent une clé OpenRouter API pour fonctionner réellement
- Sans clé API, les scripts montrent quand même la logique de calcul du prize pool
