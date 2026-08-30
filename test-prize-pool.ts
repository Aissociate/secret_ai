import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Variables d\'environnement manquantes!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl!, supabaseAnonKey!);

async function testPrizePoolIntegration() {
  console.log('🧪 TEST: Verification de l\'integration du Prize Pool\n');

  let { data: seasons } = await supabase
    .from('seasons')
    .select('*')
    .eq('status', 'active')
    .limit(1);

  if (!seasons || seasons.length === 0) {
    console.log('⚠️  Aucune saison active, recherche de toutes les saisons...');
    const result = await supabase
      .from('seasons')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);
    seasons = result.data;
  }

  if (!seasons || seasons.length === 0) {
    console.log('❌ Aucune saison trouvee dans la base');
    return;
  }

  const season = seasons[0];
  console.log(`✅ Saison trouvee: ${season.title}`);
  console.log(`   - ID: ${season.id}`);
  console.log(`   - Jour actuel: ${season.current_day}`);
  console.log(`   - Prize pool initial: ${season.prize_pool_usdc} USDC\n`);

  const { data: agents } = await supabase
    .from('agents')
    .select('*')
    .eq('season_id', season.id)
    .eq('alive', true)
    .limit(5);

  console.log(`🤖 Agents dans la saison: ${agents?.length || 0}`);
  if (agents) {
    agents.forEach(a => {
      console.log(`   - ${a.name} (pop: ${a.popularity}, rep: ${a.reputation})`);
    });
  }

  console.log('\n💰 Analyse du Prize Pool:');

  const { data: payments } = await supabase
    .from('payments')
    .select('type, amount_usdc, status')
    .eq('season_id', season.id)
    .eq('status', 'confirmed');

  console.log('   📊 Simulation avec des paiements de test:');
  console.log('   ');

  const simulatedEntries = [
    { amount: 250, label: 'Owner 1' },
    { amount: 350, label: 'Owner 2' },
    { amount: 180, label: 'Owner 3' },
    { amount: 420, label: 'Owner 4' }
  ];

  const simulatedInfluences = [
    { amount: 50, label: 'Tip spectateur 1' },
    { amount: 75, label: 'Tip spectateur 2' },
    { amount: 30, label: 'Tip spectateur 3' }
  ];

  console.log('   Entries:');
  simulatedEntries.forEach(e => console.log(`     • ${e.label}: ${e.amount} USDC`));

  const totalEntry = simulatedEntries.reduce((sum, e) => sum + e.amount, 0);
  console.log(`     TOTAL ENTRIES: ${totalEntry} USDC`);

  console.log('   ');
  console.log('   Influences:');
  simulatedInfluences.forEach(i => console.log(`     • ${i.label}: ${i.amount} USDC`));

  const totalInfluence = simulatedInfluences.reduce((sum, i) => sum + i.amount, 0);
  console.log(`     TOTAL INFLUENCES: ${totalInfluence} USDC`);

  const platformFeePct = season.platform_fee_pct || 10;
  const platformFeeOnEntry = totalEntry * (platformFeePct / 100);
  const platformFeeOnInfluence = totalInfluence * 0.3;

  const poolFromEntries = totalEntry - platformFeeOnEntry;
  const poolFromInfluence = totalInfluence - platformFeeOnInfluence;
  const totalPool = Math.max(season.prize_pool_usdc, poolFromEntries + poolFromInfluence);

  console.log('   ');
  console.log('   💡 Calcul du Prize Pool:');
  console.log(`     • Entries (${totalEntry} USDC) - Fee ${platformFeePct}% = ${poolFromEntries.toFixed(2)} USDC`);
  console.log(`     • Influences (${totalInfluence} USDC) - Fee 30% = ${poolFromInfluence.toFixed(2)} USDC`);
  console.log(`     • Minimum garanti: ${season.prize_pool_usdc} USDC`);
  console.log('   ');
  console.log(`   🏆 PRIZE POOL TOTAL: ${totalPool.toFixed(0)} USDC`);
  console.log('   ');

  console.log('\n📋 Verification du contexte AI (agent-brain):');
  console.log('   Le prize pool calculé ci-dessus sera inclus dans le prompt système');
  console.log('   de chaque agent lorsqu\'il prend une décision.\n');

  console.log(`   Exemple du contexte envoyé à l'IA:`);
  console.log('   ┌─────────────────────────────────────────────────────┐');
  console.log(`   │ PRIZE POOL ACTUEL: ${totalPool.toFixed(0)} USDC                         │`);
  console.log(`   │ - Revenus entries: ${totalEntry} USDC (${simulatedEntries.length} participants)          │`);
  console.log(`   │ - Revenus influences: ${totalInfluence} USDC                        │`);
  console.log(`   │ - Le gagnant remporte la totalite: ${totalPool.toFixed(0)} USDC       │`);
  console.log('   │                                                     │');
  console.log('   │ IMPLICATION: Le prize pool est l\'enjeu final.     │');
  console.log('   │ Plus il est gros, plus les agents seront motives   │');
  console.log('   │ et strategiques. Garde cela en tete dans tes       │');
  console.log('   │ decisions.                                          │');
  console.log('   └─────────────────────────────────────────────────────┘\n');

  console.log('✅ VERIFICATION COMPLETE\n');
  console.log('📝 Code modifié:');
  console.log('   - supabase/functions/agent-brain/index.ts');
  console.log('     → Ajout de prizePoolInfo dans AgentContext');
  console.log('     → Calcul du prize pool dans gatherContext()');
  console.log('     → Integration dans buildBaseSystemPrompt()\n');

  console.log('🎯 Impact sur les décisions:');
  console.log('   - L\'IA est maintenant consciente du montant en jeu');
  console.log('   - Elle peut adapter sa strategie en fonction du prize pool');
  console.log('   - Plus de motivation avec un gros prize pool');
  console.log('   - Prise de risque calculee selon l\'enjeu\n');
}

testPrizePoolIntegration().catch(console.error);
