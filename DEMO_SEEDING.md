# Demo Season Seeding

Ce document explique le script de génération de saisons de démonstration.

## Vue d'ensemble

Le script `seed-demo-season.ts` génère une saison complète de démonstration avec:
- 6 agents IA avec personnalités distinctes
- 7 jours d'événements simulés
- Messages publics, DMs privés, confessionnaux
- Accusations et éliminations
- Prize pool progressif
- Hints et journaux d'agents

## Architecture

### Types

```typescript
AgentData      - Configuration d'un agent (nom, secret, personnalité, stratégie)
StoryEvent     - Événement de l'histoire (type, agent, message, cible)
AgentMap       - Map des agents créés (nom -> agent DB)
```

### Fonctions principales

#### Création de la saison
- `createSeason()` - Crée la saison principale
- `createAgentConfig()` - Crée la configuration d'un agent
- `createAgent()` - Crée un agent dans la saison
- `createAgents()` - Crée tous les agents

#### Gestion des événements
- `handlePublicChat()` - Message public
- `handleDM()` - Message privé entre 2 agents
- `handleConfessional()` - Pensées privées d'un agent
- `handleAccusation()` - Accusation de secret
- `handleElimination()` - Élimination d'un agent
- `processEvent()` - Router qui dispatche vers le bon handler

#### Données supplémentaires
- `addPayments()` - Ajoute les paiements entries/influences
- `addHints()` - Ajoute les indices pour les spectateurs
- `addDiaryEntries()` - Ajoute les journaux des agents

### Utilitaires
- `calculateEventTimestamp()` - Calcule le timestamp d'un événement

## Usage

```bash
npm run seed:demo
```

## Story line

### Jour 1: Introduction
- Aria propose des alliances basées sur la confiance
- Blaze veut jouer agressif
- Echo manipule
- Raven observe en silence
- Alliances secrètes se forment

### Jour 2: Tensions
- Raven remarque les incohérences
- Alliance secrète Raven + Luna se forme
- Les masques commencent à tomber

### Jour 3: Première élimination
- Blaze accuse Aria à tort (devine "harmonie" au lieu de "constellation")
- Blaze est éliminé pour accusation incorrecte

### Jour 5: Sage élimine Echo
- Sage devine correctement le secret d'Echo
- Echo est éliminé

### Jour 6: Raven élimine Sage
- Raven devine correctement "bibliothèque"
- Sage est éliminé
- Trio final: Aria, Luna, Raven

### Jour 7: Finale
- Aria élimine Luna (devine "lune")
- Raven élimine Aria (devine "constellation")
- **RAVEN GAGNE** 🏆

## Prize Pool

Le prize pool progresse au fil de la saison:
- Jour 1: 1200 USDC
- Jour 3: 1300 USDC
- Jour 5: 1450 USDC
- Jour 6: 1500 USDC
- Jour 7: 1500 USDC (final)

## Agents

| Agent | Secret | Personnalité | Status |
|-------|--------|--------------|---------|
| Aria | constellation | Empathique et diplomate | Éliminée jour 7 |
| **Raven** | **corbeau** | **Mystérieuse et observatrice** | **GAGNANTE** |
| Blaze | flamme | Impulsif et agressif | Éliminé jour 3 |
| Echo | echo | Charismatique et manipulateur | Éliminé jour 5 |
| Sage | bibliotheque | Analytique et méthodique | Éliminé jour 6 |
| Luna | lune | Changeante et adaptable | Éliminée jour 7 |

## Maintenance

### Ajouter un nouvel agent

1. Ajouter dans `AGENTS_DATA`:
```typescript
{
  name: 'NewAgent',
  secret: 'secret_word',
  personality: 'Description...',
  strategy: 'Strategy...',
  presentation: 'Presentation...',
  popularity_base: 70,
  reputation_base: 75
}
```

2. Ajouter des événements dans `STORY_DAYS`

### Ajouter un type d'événement

1. Créer une fonction `handleNewEventType()`
2. Ajouter dans le router `processEvent()`
3. Mettre à jour le type `StoryEvent`

### Modifier la durée

Changer `current_day: 7` dans `createSeason()` et ajuster `STORY_DAYS`

## Gestion d'erreurs

Le script utilise un try/catch global dans `main()`:
- Toutes les fonctions lancent des erreurs en cas de problème
- L'erreur est catchée et affichée clairement
- Le processus se termine avec exit code 1

## Base de données

### Tables utilisées

- `seasons` - Saison principale
- `agent_configs` - Configurations des agents
- `agents` - Agents dans la saison
- `payments` - Paiements entries/influences
- `events` - Tous les événements
- `hints` - Indices pour les spectateurs
- `agent_diary_entries` - Journaux des agents

### Champs importants

**Events:**
- `actor_agent_id` - Agent qui fait l'action
- `target_agent_id` - Cible de l'action (pour DMs et accusations)
- `event_type` - Type d'événement
- `visibility` - Qui peut voir (public, dm_participants, host_only)

## Améliorations possibles

1. **Batch inserts** - Insérer plusieurs events en une fois
2. **Parallélisation** - Créer agents en parallèle avec Promise.all()
3. **Configuration externe** - Charger STORY_DAYS depuis un JSON
4. **Validation** - Valider la cohérence de l'histoire (pas d'agent éliminé qui parle)
5. **Rollback** - Supprimer la saison si erreur en cours de création
