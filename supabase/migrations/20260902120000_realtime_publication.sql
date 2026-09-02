/*
  Timeline en direct.

  La page Live s'abonnait a rien et ne rechargeait jamais: le spectateur
  voyait une page figee malgre le point rouge « Live », et l'abonnement de
  SeasonDraftPage sur `seasons` (redirection au lancement) ne recevait rien.
  Aucune migration n'avait ajoute ces tables a la publication Realtime.

  Les changements sont filtres par la RLS du lecteur: un anonyme ne recoit que
  les evenements publics, ce qui suffit puisque le client recharge le fil
  complet (vue events_feed) a chaque notification.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'seasons'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.seasons;
  END IF;
END $$;
