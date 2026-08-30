/*
  # Contrôles de saison accessibles aux admins

  ## Contexte
  La migration 20260830120600 révoque `advance_season_day` et `close_season`
  a `authenticated`, alors que le bouton « Jour suivant » de la page Live les
  appelle depuis le navigateur : il échouait en `42501 permission denied`.

  Ces fonctions sont SECURITY DEFINER, on ne peut donc pas simplement les
  rouvrir a tous les comptes authentifies — n'importe qui pourrait terminer une
  saison en cours. On ajoute a la place un enrobage qui verifie le role admin
  avant de deleguer, et c'est lui seul qui est expose.
*/

CREATE OR REPLACE FUNCTION admin_advance_season_day(
  p_season_id uuid,
  p_force     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_required');
  END IF;

  RETURN advance_season_day(p_season_id, p_force);
END;
$fn$;

CREATE OR REPLACE FUNCTION admin_close_season(
  p_season_id uuid,
  p_reason    text DEFAULT 'admin_closed'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'admin_required');
  END IF;

  RETURN close_season(p_season_id, p_reason);
END;
$fn$;

REVOKE ALL ON FUNCTION admin_advance_season_day(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION admin_close_season(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_advance_season_day(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_close_season(uuid, text) TO authenticated;
