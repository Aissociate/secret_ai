/*
  # Populate agents + hints when season auto-launches

  ## Summary
  Updates the auto_launch_season_when_full trigger function so that when
  the season transitions from 'draft' to 'live', it also:

  1. Creates an `agents` record for every season_enrollment, copying all
     relevant fields from the corresponding `agent_configs` row.
  2. Creates 3 `hints` records per agent from the config's hint_1/2/3 fields.
  3. Sets the season's prize_pool_usdc = max_agents * entry_fee_usdc
     * (1 - platform_fee_pct / 100).

  ## New Agents columns populated
  - season_id, owner_user_id, agent_config_id
  - name, avatar_url, llm_provider, llm_model
  - secret_keyword, presentation
  - alive=true, popularity=50, reputation=50
  - owner_influences_remaining=2, confessional_count=0
  - api_key = unique random key (hex)

  ## Security
  - Function runs with SECURITY DEFINER so a non-admin owner's INSERT on
    season_enrollments can still write to agents / hints / seasons.
*/

CREATE OR REPLACE FUNCTION auto_launch_season_when_full()
RETURNS trigger AS $$
DECLARE
  v_season         record;
  v_enrolled_count integer;
  v_enr            record;
  v_cfg            record;
  v_agent_id       uuid;
  v_prize_pool     numeric;
BEGIN
  SELECT * INTO v_season
  FROM seasons
  WHERE id = NEW.season_id AND status = 'draft';

  IF v_season IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_enrolled_count
  FROM season_enrollments
  WHERE season_id = NEW.season_id;

  IF v_enrolled_count < v_season.max_agents THEN
    RETURN NEW;
  END IF;

  v_prize_pool := v_season.max_agents
                  * v_season.entry_fee_usdc
                  * (1.0 - v_season.platform_fee_pct::numeric / 100.0);

  FOR v_enr IN
    SELECT * FROM season_enrollments WHERE season_id = NEW.season_id
  LOOP
    IF EXISTS (
      SELECT 1 FROM agents
      WHERE season_id = NEW.season_id
        AND agent_config_id = v_enr.agent_config_id
    ) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_cfg
    FROM agent_configs
    WHERE id = v_enr.agent_config_id;

    IF v_cfg IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO agents (
      season_id,
      owner_user_id,
      agent_config_id,
      name,
      avatar_url,
      llm_provider,
      llm_model,
      secret_keyword,
      presentation,
      alive,
      popularity,
      reputation,
      owner_influences_remaining,
      confessional_count,
      api_key
    ) VALUES (
      NEW.season_id,
      v_enr.owner_user_id,
      v_enr.agent_config_id,
      v_cfg.name,
      v_cfg.avatar_url,
      'openrouter',
      v_cfg.openrouter_model,
      v_cfg.secret_keyword,
      COALESCE(v_cfg.presentation, ''),
      true,
      50,
      50,
      2,
      0,
      encode(gen_random_bytes(16), 'hex')
    )
    RETURNING id INTO v_agent_id;

    INSERT INTO hints (agent_id, level, hint_text, unlocked)
    VALUES
      (v_agent_id, 1, v_cfg.hint_1, false),
      (v_agent_id, 2, v_cfg.hint_2, false),
      (v_agent_id, 3, v_cfg.hint_3, false);
  END LOOP;

  UPDATE seasons
  SET
    status        = 'live',
    started_at    = now(),
    prize_pool_usdc = v_prize_pool
  WHERE id = NEW.season_id AND status = 'draft';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_auto_launch_season ON season_enrollments;

CREATE TRIGGER trigger_auto_launch_season
  AFTER INSERT ON season_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION auto_launch_season_when_full();
