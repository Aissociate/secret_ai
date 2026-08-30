import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Variables d\'environnement manquantes!');
  console.error('Assurez-vous que .env contient:');
  console.error('  - VITE_SUPABASE_URL');
  console.error('  - SUPABASE_SERVICE_ROLE_KEY (ou VITE_SUPABASE_ANON_KEY)');
  console.error('  - OPENROUTER_API_KEY (optionnel pour test simple)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey!);

const agentConfigs = [
  {
    name: 'Luna',
    secret: 'papillon',
    personality: 'Charismatique, manipulatrice, theatrale',
    strategy: 'Creer des alliances puis les trahir au bon moment',
    presentation: 'La reine du drama qui sait tout jouer'
  },
  {
    name: 'Marcus',
    secret: 'bibliotheque',
    personality: 'Analytique, reserve, observateur',
    strategy: 'Rester en retrait et analyser les comportements',
    presentation: 'Le stratege silencieux qui calcule tout'
  },
  {
    name: 'Aria',
    secret: 'violon',
    personality: 'Empathique, sociale, diplomate',
    strategy: 'Creer des alliances sinceres et jouer la mediateur',
    presentation: 'La pacificatrice qui unit les agents'
  },
  {
    name: 'Zeke',
    secret: 'montagne',
    personality: 'Direct, impulsif, competitif',
    strategy: 'Attaquer frontalement et semer le chaos',
    presentation: 'Le provocateur qui aime le conflit'
  },
  {
    name: 'Nova',
    secret: 'etoile',
    personality: 'Mysterieuse, intuitive, artistique',
    strategy: 'Rester enigmatique et observer les failles',
    presentation: 'L\'enigme qui fascine et intrigue'
  }
];

async function createTestSeason() {
  console.log('🎬 Creation de la saison de test...');

  const { data: season, error: seasonError } = await supabase
    .from('seasons')
    .insert({
      title: 'Test Season - Prize Pool Simulation',
      started_at: new Date().toISOString(),
      current_day: 1,
      prize_pool_usdc: 1000,
      platform_fee_pct: 10,
      entry_fee_usdc: 100,
      max_agents: 10,
      status: 'active'
    })
    .select()
    .single();

  if (seasonError) throw seasonError;
  console.log(`✅ Saison creee: ${season.id}`);

  return season;
}

async function createTestAgents(seasonId: string) {
  console.log('🤖 Creation des agents...');

  const agents = [];

  for (const config of agentConfigs) {
    const { data: agentConfig, error: configError } = await supabase
      .from('agent_configs')
      .insert({
        display_name: config.name,
        system_prompt: `Tu es ${config.name}. ${config.strategy}`,
        personality_traits: config.personality,
        strategy_notes: config.strategy,
        openrouter_api_key: OPENROUTER_API_KEY,
        openrouter_model: 'anthropic/claude-3.5-sonnet'
      })
      .select()
      .single();

    if (configError) throw configError;

    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .insert({
        season_id: seasonId,
        agent_config_id: agentConfig.id,
        name: config.name,
        secret_keyword: config.secret,
        presentation: config.presentation,
        popularity: 50,
        reputation: 50,
        alive: true,
        owner_influences_remaining: 2
      })
      .select()
      .single();

    if (agentError) throw agentError;

    agents.push(agent);
    console.log(`  ✅ ${config.name} cree (secret: ${config.secret})`);
  }

  return agents;
}

async function simulateEntryPayments(seasonId: string, agents: any[]) {
  console.log('💰 Simulation des paiements d\'entree...');

  const { data: existingUsers } = await supabase
    .from('users')
    .select('id, email, username')
    .eq('role', 'owner')
    .limit(agents.length);

  if (!existingUsers || existingUsers.length === 0) {
    console.log('  ⚠️ Aucun utilisateur owner existant. Creation de paiements anonymes...');

    for (let i = 0; i < agents.length; i++) {
      const entryAmount = 100 + Math.random() * 400;

      await supabase.from('payments').insert({
        season_id: seasonId,
        agent_id: agents[i].id,
        type: 'entry',
        amount_usdc: entryAmount,
        status: 'confirmed',
        blockchain_tx_hash: `0xtest${Date.now()}${i}`,
        paid_at: new Date().toISOString()
      });

      console.log(`  ✅ Paiement entry de ${entryAmount.toFixed(0)} USDC pour ${agents[i].name}`);
    }
  } else {
    for (let i = 0; i < Math.min(agents.length, existingUsers.length); i++) {
      const user = existingUsers[i];
      const entryAmount = 100 + Math.random() * 400;

      await supabase.from('agent_enrollments').insert({
        user_id: user.id,
        agent_id: agents[i].id,
        season_id: seasonId,
        role: 'owner'
      });

      await supabase.from('payments').insert({
        user_id: user.id,
        season_id: seasonId,
        agent_id: agents[i].id,
        type: 'entry',
        amount_usdc: entryAmount,
        status: 'confirmed',
        blockchain_tx_hash: `0xtest${Date.now()}${i}`,
        paid_at: new Date().toISOString()
      });

      console.log(`  ✅ ${user.email} paie ${entryAmount.toFixed(0)} USDC pour ${agents[i].name}`);
    }
  }
}

async function simulateInfluencePayments(seasonId: string, agents: any[]) {
  console.log('💸 Simulation des paiements d\'influence...');

  for (let i = 0; i < 3; i++) {
    const randomAgent = agents[Math.floor(Math.random() * agents.length)];
    const amount = 10 + Math.random() * 40;

    await supabase.from('payments').insert({
      season_id: seasonId,
      type: 'influence',
      amount_usdc: amount,
      status: 'confirmed',
      blockchain_tx_hash: `0xtip${Date.now()}${i}`,
      paid_at: new Date().toISOString()
    });

    await supabase.from('events').insert({
      season_id: seasonId,
      day_number: 1,
      event_type: 'spectator_influence',
      target_agent_id: randomAgent.id,
      payload_json: {
        message: `Je te soutiens ! Continue comme ca !`,
        amount_usdc: amount,
        from_username: `spectator${i}`
      },
      visibility: 'public'
    });

    console.log(`  ✅ spectator${i} donne ${amount.toFixed(0)} USDC a ${randomAgent.name}`);
  }
}

async function callAgentBrain(agentId: string, seasonId: string, action: string, body: any = {}) {
  if (!OPENROUTER_API_KEY) {
    console.log(`  ⏭️ Skip ${action} (pas d'API key OpenRouter configuree)`);
    return null;
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/agent-brain`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`
      },
      body: JSON.stringify({
        agent_id: agentId,
        season_id: seasonId,
        action,
        ...body
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`  ❌ Erreur agent-brain pour ${action}: ${error.slice(0, 100)}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`  ❌ Exception lors de ${action}:`, error);
    return null;
  }
}

async function simulateDay(seasonId: string, agents: any[], dayNumber: number) {
  console.log(`\n📅 === JOUR ${dayNumber} ===`);

  await supabase
    .from('seasons')
    .update({ current_day: dayNumber })
    .eq('id', seasonId);

  const aliveAgents = agents.filter(a => a.alive);

  console.log(`\n💬 Messages publics...`);
  for (const agent of aliveAgents.slice(0, 3)) {
    const result = await callAgentBrain(agent.id, seasonId, 'public_chat', {});
    if (result?.message) {
      console.log(`  ${agent.name}: "${result.message.slice(0, 80)}..."`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n📨 Messages prives...`);
  if (aliveAgents.length >= 2) {
    const agent1 = aliveAgents[0];
    const agent2 = aliveAgents[1];

    const result = await callAgentBrain(agent1.id, seasonId, 'dm', {
      target_agent_name: agent2.name
    });
    if (result?.dm_message) {
      console.log(`  ${agent1.name} -> ${agent2.name}: "${result.dm_message.slice(0, 60)}..."`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n🎥 Confessionnaux...`);
  for (const agent of aliveAgents.slice(0, 2)) {
    const result = await callAgentBrain(agent.id, seasonId, 'confessional', {});
    if (result?.confessional) {
      console.log(`  ${agent.name}: "${result.confessional.slice(0, 80)}..."`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (dayNumber >= 3 && aliveAgents.length > 2) {
    console.log(`\n⚠️ Accusations...`);
    const accuser = aliveAgents[0];
    const result = await callAgentBrain(accuser.id, seasonId, 'accusation', {});

    if (result?.accused) {
      if (result.correct) {
        console.log(`  🎯 ${accuser.name} accuse correctement ${result.target} ! Secret: ${result.guess}`);
        const eliminated = agents.find(a => a.name === result.target);
        if (eliminated) {
          eliminated.alive = false;
          await supabase
            .from('agents')
            .update({ alive: false })
            .eq('id', eliminated.id);
        }
      } else {
        console.log(`  ❌ ${accuser.name} se trompe sur ${result.target} (guess: ${result.guess})`);
      }
    } else {
      console.log(`  🤔 ${accuser.name} ne se sent pas assez confiant pour accuser`);
    }
  }

  const { data: payments } = await supabase
    .from('payments')
    .select('type, amount_usdc')
    .eq('season_id', seasonId)
    .eq('status', 'confirmed');

  const totalEntry = payments?.filter(p => p.type === 'entry').reduce((sum, p) => sum + p.amount_usdc, 0) || 0;
  const totalInfluence = payments?.filter(p => p.type === 'influence').reduce((sum, p) => sum + p.amount_usdc, 0) || 0;
  const prizePool = (totalEntry * 0.9) + (totalInfluence * 0.7);

  console.log(`\n💰 Prize Pool: ${prizePool.toFixed(0)} USDC (${aliveAgents.length} agents restants)`);
}

async function displayFinalResults(seasonId: string, agents: any[]) {
  console.log('\n🏆 === RESULTATS FINAUX ===\n');

  const { data: payments } = await supabase
    .from('payments')
    .select('*')
    .eq('season_id', seasonId)
    .eq('status', 'confirmed');

  const entryPayments = payments?.filter(p => p.type === 'entry') || [];
  const influencePayments = payments?.filter(p => p.type === 'influence') || [];

  const totalEntry = entryPayments.reduce((sum, p) => sum + p.amount_usdc, 0);
  const totalInfluence = influencePayments.reduce((sum, p) => sum + p.amount_usdc, 0);

  const prizePool = (totalEntry * 0.9) + (totalInfluence * 0.7);

  console.log('💰 Prize Pool Final:');
  console.log(`  - Revenus entries: ${totalEntry.toFixed(0)} USDC (${entryPayments.length} participants)`);
  console.log(`  - Revenus influences: ${totalInfluence.toFixed(0)} USDC (${influencePayments.length} tips)`);
  console.log(`  - Total prize pool: ${prizePool.toFixed(0)} USDC`);

  console.log('\n🎭 Etat des agents:');
  for (const agent of agents) {
    const { data: updatedAgent } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agent.id)
      .single();

    const status = updatedAgent?.alive ? '✅ EN VIE' : '💀 ELIMINÉ';
    console.log(`  ${status} ${agent.name} - Pop: ${updatedAgent?.popularity}/100, Rep: ${updatedAgent?.reputation}/100`);
  }

  const { data: events } = await supabase
    .from('events')
    .select('event_type')
    .eq('season_id', seasonId);

  console.log('\n📊 Statistiques:');
  console.log(`  - Public chats: ${events?.filter(e => e.event_type === 'public_chat').length || 0}`);
  console.log(`  - DMs: ${events?.filter(e => e.event_type === 'private_dm').length || 0}`);
  console.log(`  - Confessionnaux: ${events?.filter(e => e.event_type === 'confessional').length || 0}`);
  console.log(`  - Accusations: ${events?.filter(e => e.event_type === 'accusation').length || 0}`);
  console.log(`  - Eliminations: ${events?.filter(e => e.event_type === 'elimination').length || 0}`);
}

async function main() {
  console.log('🚀 SIMULATION COMPLETE D\'UNE SAISON\n');

  try {
    const season = await createTestSeason();
    const agents = await createTestAgents(season.id);

    await simulateEntryPayments(season.id, agents);
    await simulateInfluencePayments(season.id, agents);

    console.log('\n🎬 Demarrage de la simulation des jours...');

    for (let day = 1; day <= 5; day++) {
      await simulateDay(season.id, agents, day);
      await new Promise(resolve => setTimeout(resolve, 2000));

      const aliveCount = agents.filter(a => a.alive).length;
      if (aliveCount <= 1) {
        console.log('\n🎊 Un seul agent reste ! Fin de la saison.');
        break;
      }
    }

    await displayFinalResults(season.id, agents);

    console.log('\n✅ SIMULATION TERMINEE AVEC SUCCES !');
    console.log(`\n📝 Season ID: ${season.id}`);
    console.log(`🔗 Voir dans l'app: /show/season/${season.id}`);

  } catch (error) {
    console.error('❌ Erreur:', error);
    process.exit(1);
  }
}

main();
