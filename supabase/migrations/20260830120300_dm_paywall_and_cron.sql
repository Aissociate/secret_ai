/*
  # Paywall des DM + planification des taches

  ## Contexte
  Les messages prives etaient inseres avec `visibility = 'public'` et leur texte
  integral dans `payload_json.message`. La policy generique les renvoyait donc en
  entier, et le masquage n'existait que dans le rendu React: le contenu payant
  etait lisible dans l'onglet Reseau. La fonctionnalite `purchaseDmReveal`
  vendait un acces deja gratuit.

  On ne peut pas simplement passer les DM en `private_admin`: le feed doit
  continuer a montrer qu'un DM a eu lieu (c'est un signal de jeu). La solution
  retenue est une vue qui expose l'evenement mais remplace le message par NULL
  tant que le spectateur n'a pas paye.

  ## Contenu
  - Vue `events_feed` : contenu des DM masque sauf achat, participation ou admin
  - Migration des DM existants vers `visibility = 'private_admin'`
  - Jobs pg_cron reconfigures sans URL ni JWT en dur
*/

-- ---------------------------------------------------------------------------
-- 1. Vue de feed avec masquage serveur
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW events_feed
WITH (security_invoker = false) AS
SELECT
  e.id,
  e.season_id,
  e.day_number,
  e.event_type,
  e.actor_agent_id,
  e.target_agent_id,
  e.actor_user_id,
  e.visibility,
  e.created_at,
  e.video_job_id,
  CASE
    -- Un evenement non prive est visible tel quel.
    WHEN e.event_type <> 'private_dm' THEN e.payload_json

    -- Admin: acces complet.
    WHEN EXISTS (
      SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin'
    ) THEN e.payload_json

    -- Proprietaire d'un des deux agents impliques.
    WHEN EXISTS (
      SELECT 1 FROM agents a
      WHERE a.id IN (e.actor_agent_id, e.target_agent_id)
        AND a.owner_user_id = auth.uid()
    ) THEN e.payload_json

    -- Spectateur ayant paye la revelation.
    WHEN EXISTS (
      SELECT 1 FROM dm_reveals d
      WHERE d.event_id = e.id AND d.user_id = auth.uid()
    ) THEN e.payload_json

    -- Saison terminee: tout est revele.
    WHEN EXISTS (
      SELECT 1 FROM seasons s WHERE s.id = e.season_id AND s.status = 'ended'
    ) THEN e.payload_json

    -- Sinon: on annonce le DM sans en livrer le contenu.
    ELSE jsonb_build_object(
      'locked', true,
      'preview', 'Un message prive a ete echange.'
    )
  END AS payload_json
FROM events e
WHERE e.visibility = 'public'
   OR e.event_type = 'private_dm'
   OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin');

GRANT SELECT ON events_feed TO anon, authenticated;

/*
  Les DM deja enregistres en clair restent lisibles via la table `events` tant
  qu'ils portent visibility = 'public'. On les bascule en 'private_admin': la
  vue ci-dessus continue de les afficher (masques), mais un acces direct a la
  table ne les renvoie plus.
*/
UPDATE events
SET visibility = 'private_admin'
WHERE event_type = 'private_dm' AND visibility = 'public';

-- Cette policy laissait passer le contenu complet des DM.
DROP POLICY IF EXISTS "Anon can see DM existence in feed" ON events;

-- ---------------------------------------------------------------------------
-- 2. Planification
-- ---------------------------------------------------------------------------

/*
  Les jobs existants embarquaient l'URL du projet et un JWT anon en clair dans
  le corps SQL, ce qui les rendait injouables sur un autre environnement et
  exposait la cle dans Git. On les recree via notify_edge_function(), qui lit
  sa configuration depuis les GUC de la base.

  Prerequis (a executer une fois par environnement, hors migration):
    ALTER DATABASE postgres SET app.supabase_url = 'https://<ref>.supabase.co';
    ALTER DATABASE postgres SET app.cron_secret  = '<meme valeur que CRON_SECRET>';
*/

DO $$
DECLARE
  v_job record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron absent: planification ignoree';
    RETURN;
  END IF;

  FOR v_job IN
    SELECT jobname FROM cron.job
    WHERE jobname IN (
      'agent-auto-tick', 'host-clue-every-6h', 'daily-confessionals',
      'daily-agent-hint', 'process-video-jobs', 'season-day-advance'
    )
  LOOP
    PERFORM cron.unschedule(v_job.jobname);
  END LOOP;

  PERFORM cron.schedule(
    'agent-auto-tick', '*/2 * * * *',
    $cron$SELECT notify_edge_function('auto-tick', jsonb_build_object('trigger', 'cron'))$cron$
  );

  PERFORM cron.schedule(
    'host-clue-every-6h', '0 */6 * * *',
    $cron$SELECT notify_edge_function('generate-host-clue', jsonb_build_object('mode', 'random'))$cron$
  );

  PERFORM cron.schedule(
    'daily-confessionals', '0 20 * * *',
    $cron$SELECT notify_edge_function('daily-confessionals', jsonb_build_object('trigger', 'cron'))$cron$
  );

  -- Le pipeline video n'etait declenche par aucun cron: les taches restaient
  -- 'pending' indefiniment alors que les credits Sora etaient deja consommes.
  PERFORM cron.schedule(
    'process-video-jobs', '* * * * *',
    $cron$SELECT notify_edge_function('process-video-jobs', jsonb_build_object('trigger', 'cron'))$cron$
  );

  -- Progression de saison: verifie chaque heure si une journee est ecoulee.
  PERFORM cron.schedule(
    'season-day-advance', '0 * * * *',
    $cron$SELECT tick_all_seasons()$cron$
  );
END $$;
