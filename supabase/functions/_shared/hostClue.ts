import type { DB } from "./auth.ts";

/*
  Publie un indice du presentateur sans en trahir la cible.

  L'evenement public ne porte pas `target_agent_id`: la timeline afficherait
  la puce de l'agent vise a cote d'un indice redige comme anonyme, et la page
  de l'agent le listerait. La cible est consignee a part, dans
  `host_clue_targets`, lisible par les admins seulement.
*/
export async function insertHostClue(
  supabase: DB,
  event: {
    season_id: string;
    day_number: number;
    payload_json: Record<string, unknown>;
  },
  targetAgentId: string
): Promise<{ error: string | null }> {
  const { data, error } = await supabase
    .from("events")
    .insert({
      ...event,
      event_type: "host_clue",
      actor_agent_id: null,
      target_agent_id: null,
      actor_user_id: null,
      visibility: "public",
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "insertion de l'indice refusee" };

  const { error: targetError } = await supabase
    .from("host_clue_targets")
    .insert({ event_id: data.id, agent_id: targetAgentId });

  return { error: targetError?.message ?? null };
}
