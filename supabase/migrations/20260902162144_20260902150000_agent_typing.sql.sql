/*
  « En train d'ecrire ».

  Entre deux evenements, le fil ne montrait rien: le spectateur ne savait pas
  si la maison vivait encore. auto-tick signale desormais qui prepare quoi
  (agent ou presentateur) pendant l'appel au modele, et le fil l'affiche en
  direct. Une ligne par acteur et par saison, posee a la reservation du quota
  et retiree a la fin de l'action; les lignes oubliees sont purgees au tick
  suivant.
*/

CREATE TABLE IF NOT EXISTS agent_typing (
  season_id  uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  actor      text NOT NULL,                                  -- id d'agent, ou 'host'
  agent_id   uuid REFERENCES agents(id) ON DELETE CASCADE,
  kind       text NOT NULL DEFAULT 'public_chat',
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, actor)
);

ALTER TABLE agent_typing ENABLE ROW LEVEL SECURITY;

-- Lecture publique, y compris anonyme: c'est un signal de presence, rien de
-- plus. L'ecriture reste aux fonctions Edge (service_role, hors RLS).
DROP POLICY IF EXISTS "Anyone can see who is typing" ON agent_typing;
CREATE POLICY "Anyone can see who is typing"
  ON agent_typing FOR SELECT
  USING (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agent_typing'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_typing;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Nettoyage: messages publies sans contenu
-- ---------------------------------------------------------------------------

/*
  Quand le modele renvoyait une reponse vide, auto-tick publiait quand meme
  l'evenement: des DM et des messages sans texte trainaient dans le fil. La
  fonction refuse desormais de publier un message vide; on retire ceux qui
  existent, sauf un DM qu'un spectateur aurait deja paye pour lire.
*/
DELETE FROM events e
WHERE e.event_type IN ('public_chat', 'private_dm', 'confessional')
  AND btrim(COALESCE(e.payload_json->>'message', '')) = ''
  AND NOT EXISTS (SELECT 1 FROM dm_reveals d WHERE d.event_id = e.id);

-- ---------------------------------------------------------------------------
-- Nettoyage: messages publies avec l'enveloppe JSON du modele
-- ---------------------------------------------------------------------------

/*
  Quand le modele repondait dans un bloc ```json tronque, l'analyse echouait et
  le texte brut etait publie. On recupere le champ texte quand il est present,
  et on supprime ce qui n'est pas recuperable.
*/
UPDATE events e
SET payload_json = jsonb_set(
  e.payload_json, '{message}',
  to_jsonb(btrim(
    replace(replace(replace(
      substring(e.payload_json->>'message'
                from '"(?:confessional|message|dm_message)"\s*:\s*"((?:[^"\\]|\\.)*)'),
      '\n', E'\n'), '\"', '"'), '\\', '\')
  ))
)
WHERE e.event_type IN ('public_chat', 'private_dm', 'confessional', 'accusation')
  AND (e.payload_json->>'message' LIKE '```%' OR e.payload_json->>'message' LIKE '{%')
  AND btrim(COALESCE(substring(e.payload_json->>'message'
                from '"(?:confessional|message|dm_message)"\s*:\s*"((?:[^"\\]|\\.)*)'), '')) <> '';

DELETE FROM events e
WHERE e.event_type IN ('public_chat', 'private_dm', 'confessional')
  AND (e.payload_json->>'message' LIKE '```%' OR e.payload_json->>'message' LIKE '{%')
  AND NOT EXISTS (SELECT 1 FROM dm_reveals d WHERE d.event_id = e.id);
