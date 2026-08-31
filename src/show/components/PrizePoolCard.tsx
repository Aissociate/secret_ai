import { Trophy, DollarSign, Users, Percent, TrendingUp, Gift, Crown } from 'lucide-react';
import type { PrizeBreakdown, Season, Agent } from '../api/types';

function formatUsdc(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function PrizePoolCard({
  season,
  breakdown,
  winnerAgent,
  compact = false,
}: {
  season: Season;
  breakdown: PrizeBreakdown;
  winnerAgent?: Agent | null;
  compact?: boolean;
}) {
  const isEnded = season.status === 'ended';
  const isLive = season.status === 'live';

  if (compact) {
    return (
      <div className="border border-amber-400/15 rounded-2xl p-4 bg-gradient-to-br from-amber-500/[0.04] to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 flex items-center justify-center">
              <Trophy className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <div className="text-[10px] text-amber-400/70 font-bold uppercase tracking-wider">Prize Pool</div>
              <div className="text-lg font-black text-white">{formatUsdc(breakdown.total_pool)} USDC</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-white/30">{breakdown.participants_count} participants</div>
            <div className="text-xs text-white/50">{formatUsdc(breakdown.entry_fee)} USDC / entree</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-white/[0.06] rounded-2xl overflow-hidden bg-white/[0.02]">
      <div className="bg-gradient-to-br from-amber-500/[0.08] via-amber-400/[0.03] to-transparent p-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/20 flex items-center justify-center">
            <Trophy className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <div className="text-[10px] text-amber-400/70 font-bold uppercase tracking-wider">
              {isEnded ? 'Resultat final' : isLive ? 'Prize Pool Live' : 'Prize Pool Estime'}
            </div>
            <div className="text-2xl font-black text-white leading-tight">
              {formatUsdc(breakdown.total_pool)} <span className="text-sm font-bold text-white/40">USDC</span>
            </div>
          </div>
        </div>

        {isLive && (
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-1000"
              style={{ width: `${Math.min(100, (breakdown.participants_count / season.max_agents) * 100)}%` }}
            />
          </div>
        )}

        {winnerAgent && isEnded && (
          <div className="mt-4 flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-400/20">
            <Crown className="w-5 h-5 text-amber-400" />
            <div>
              <div className="text-[10px] text-amber-400/70 font-bold uppercase">Gagnante</div>
              <div className="text-sm font-bold text-white">{winnerAgent.name}</div>
            </div>
          </div>
        )}
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <DollarSign className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-white/40 font-bold uppercase">Entrees</span>
            </div>
            <div className="text-sm font-bold text-white">{formatUsdc(breakdown.entry_revenue)} USDC</div>
            <div className="text-[10px] text-white/25 mt-0.5">{formatUsdc(breakdown.entry_fee)} x {breakdown.participants_count}</div>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp className="w-3 h-3 text-sky-400" />
              <span className="text-[10px] text-white/40 font-bold uppercase">Influences</span>
            </div>
            <div className="text-sm font-bold text-white">{formatUsdc(breakdown.influence_revenue)} USDC</div>
            <div className="text-[10px] text-white/25 mt-0.5">{formatUsdc(breakdown.influence_fee)} USDC / msg</div>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Percent className="w-3 h-3 text-red-400" />
              <span className="text-[10px] text-white/40 font-bold uppercase">Frais plateforme</span>
            </div>
            <div className="text-sm font-bold text-white">{formatUsdc(breakdown.platform_fee_amount)} USDC</div>
            <div className="text-[10px] text-white/25 mt-0.5">{breakdown.platform_fee_pct}% sur entrees</div>
          </div>

          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Users className="w-3 h-3 text-teal-400" />
              <span className="text-[10px] text-white/40 font-bold uppercase">Participants</span>
            </div>
            <div className="text-sm font-bold text-white">{breakdown.participants_count} / {season.max_agents}</div>
            <div className="text-[10px] text-white/25 mt-0.5">agents inscrits</div>
          </div>
        </div>

        <div className="border border-white/[0.06] rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Gift className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-bold text-white/60 uppercase tracking-wider">Repartition</span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">Gagnant (dernier survivant)</span>
              <span className="text-xs font-bold text-amber-400">{formatUsdc(breakdown.winner_share)} USDC</span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400"
                style={{ width: breakdown.total_pool > 0 ? '100%' : '0%' }}
              />
            </div>
          </div>

          <div className="pt-2 border-t border-white/[0.04]">
            <div className="text-[10px] text-white/30 leading-relaxed">
              Le prize pool est constitue des droits d'entree (moins {breakdown.platform_fee_pct}% de frais plateforme)
              et de 70% des revenus d'influence. Le gagnant remporte la totalite du pool.
            </div>
          </div>
        </div>

        {season.status === 'draft' && (
          <div className="border border-teal-400/15 rounded-xl p-4 bg-teal-500/[0.03]">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-3.5 h-3.5 text-teal-400" />
              <span className="text-xs font-bold text-teal-400/80 uppercase tracking-wider">Estimation</span>
            </div>
            <div className="text-xs text-white/40 leading-relaxed">
              Si {season.max_agents} agents s'inscrivent a {formatUsdc(breakdown.entry_fee)} USDC, le pool atteindra environ{' '}
              <span className="text-white font-bold">
                {formatUsdc(season.max_agents * Number(season.entry_fee_usdc) * (1 - season.platform_fee_pct / 100))} USDC
              </span>{' '}
              (hors revenus d'influence).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
