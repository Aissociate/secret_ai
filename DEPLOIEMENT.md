# Déploiement et configuration

Ce document liste ce qu'il faut configurer pour que l'application fonctionne
après les correctifs de sécurité et l'ajout du cycle de vie de saison.

## 1. Variables d'environnement du front (`.env`)

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<clé anon>
```

L'application lève désormais une erreur explicite au démarrage si ces deux
variables sont absentes, au lieu d'échouer plus tard avec un message obscur.

## 2. Secrets des fonctions Edge

```bash
supabase secrets set CRON_SECRET="$(openssl rand -hex 32)"
```

```bash
supabase secrets set ALLOWED_ORIGIN="https://votre-domaine.example"
```

- **`CRON_SECRET`** (obligatoire) : partagé entre la base et les fonctions
  planifiées. Sans lui, `auto-tick`, `daily-confessionals`, `generate-host-clue`
  et `process-video-jobs` répondent `503` — c'est volontaire : ces fonctions
  agissent avec la clé `service_role` et ne doivent pas être appelables par
  n'importe qui. La clé `anon` ne les protégeait pas, puisqu'elle est publique
  et présente dans le bundle JavaScript.
- **`ALLOWED_ORIGIN`** (recommandé) : restreint le CORS. Par défaut `*`, ce qui
  autorise n'importe quel site à appeler les fonctions.
- **`APP_DOMAIN`** (optionnel) : nom affiché dans le message de signature
  MetaMask.

## 3. Configuration de la base

Les jobs `pg_cron` lisaient auparavant une URL de projet et un JWT écrits en dur
dans les migrations. Ils passent maintenant par `notify_edge_function()`, qui
lit sa configuration depuis les paramètres de la base :

```sql
ALTER DATABASE postgres SET app.supabase_url = 'https://<ref>.supabase.co';
```

```sql
ALTER DATABASE postgres SET app.cron_secret = '<même valeur que CRON_SECRET>';
```

Puis rechargez la configuration :

```sql
SELECT pg_reload_conf();
```

Sans ces deux paramètres, les tâches planifiées émettent un `WARNING` et ne font
rien — elles n'échouent pas silencieusement.

## 4. Rotation des clés compromises

Les éléments suivants étaient lisibles publiquement ou committés dans Git et
doivent être considérés comme compromis :

| Élément | Où | Action |
|---|---|---|
| JWT `anon` | en clair dans 5 migrations | rotation + purge de l'historique Git |
| Clé OpenRouter du host | table `host_agent_configs`, policy `USING (true)` | rotation |
| Clés OpenRouter des agents | table `agent_configs` | rotation |
| Clé Kie.ai | table `video_generation_settings` | rotation |
| Clés d'API des agents | colonne `agents.api_key`, lisible en anon | régénérer |

Les policies fautives sont corrigées par les migrations du 30/08, mais **les
valeurs déjà exposées le restent** : la rotation est indispensable.

Pour régénérer les clés d'agents d'une saison :

```sql
UPDATE agents SET api_key = encode(gen_random_bytes(16), 'hex') WHERE season_id = '<id>';
```

## 5. Cycle de vie d'une saison

Une saison ne progressait ni ne se terminait : `current_day` restait à 1, aucun
vainqueur n'était désigné, et les quotas journaliers ne se réinitialisaient
jamais. Le mécanisme est maintenant le suivant.

| Étape | Déclencheur | Effet |
|---|---|---|
| Lancement | dernier inscrit (trigger) | crée les agents et leurs indices, calcule la cagnotte, passe en `live`, appelle `auto-tick` |
| Journée | cron horaire → `tick_all_seasons()` | si la journée est écoulée : cérémonie d'élimination, révélation d'un indice, passage au jour suivant |
| Fin | dernier agent en lice, ou durée atteinte | `close_season()` : vainqueur, `prize_distributions`, révélation de tous les secrets |

Réglages par saison : `duration_days` (1 à 14, défaut 7) et
`day_duration_hours` (défaut 24).

Le rythme d'élimination s'adapte au nombre d'agents : avec 12 agents sur 7
jours, une élimination par jour laisserait 5 participants au dernier jour et un
vainqueur départagé au classement. Les départs restants sont donc répartis sur
les cérémonies restantes, pour que la finale se joue toujours à un contre un.

Un admin peut dérouler une saison sans attendre via le bouton **Jour suivant**
sur la page Live, ou directement :

```sql
SELECT advance_season_day('<season_id>', true);
```

## 6. Créer le premier administrateur

Le rôle est verrouillé côté base : un compte créé depuis le navigateur naît
toujours `spectator`, et aucune requête PostgREST ne peut le modifier. La
promotion se fait donc depuis l'éditeur SQL Supabase (connexion `postgres`),
qui est explicitement autorisée par le trigger :

```sql
UPDATE users SET role = 'admin' WHERE username = '<votre_username>';
```

Le rôle `service_role` est également autorisé, ce qui permet de scripter la
promotion depuis une fonction Edge si besoin.

## 7. Paiements

Aucun prestataire de paiement n'est branché : les paiements sont enregistrés en
`pending` et rien ne les confirme. Les conséquences sont assumées :

- `compute_prize_pool()` utilise la cagnotte garantie au lancement
  (`seasons.prize_pool_usdc`) comme plancher, sinon le montant affiché serait 0.
- `purchase_unlock()` enregistre la dette au tarif officiel de la saison puis
  accorde l'accès. Le trou réellement fermé est le contrôle du montant : le
  client fixait auparavant `amount_usdc` librement et pouvait donc payer 0.

Quand un prestataire sera branché, activez le contrôle strict :

```sql
ALTER DATABASE postgres SET app.require_confirmed_payment = 'true';
```

`purchase_unlock()` exigera alors un crédit confirmé suffisant.

## 8. Vérifications

```bash
npm run typecheck && npm run lint && npm run build && npm run test:season
```

`test:season` rejoue les règles de progression sur six configurations et vérifie
qu'une saison converge toujours vers un vainqueur unique.
