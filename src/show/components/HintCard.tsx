import { Link, useParams } from 'react-router-dom';
import { Lock, Unlock, Key } from 'lucide-react';
import type { Agent, Hint } from '../api/types';
import { PopularityBar, popularityTier } from './PopularityBar';
import { Badge } from './Badge';

const THRESHOLDS = [60, 80, 95];

export function HintCard({
  agent,
  hints,
}: {
  agent: Agent;
  hints: Hint[];
}) {
  const { seasonId } = useParams();
  const byLevel = (lvl: 1 | 2 | 3) => hints.find((h) => h.level === lvl);
  const tier = popularityTier(agent.popularity);
  const unlockedCount = hints.filter((h) => h.unlocked).length;

  return (
    <div className="border border-white/[0.06] rounded-2xl p-4 bg-white/[0.02] hover:bg-white/[0.03] transition-all duration-300 space-y-3">
      <div className="flex gap-3 items-center">
        <div className="relative">
          <img
            src={agent.avatar_url}
            alt={agent.name}
            className="w-11 h-11 rounded-xl object-cover ring-1 ring-white/10"
          />
          {agent.alive && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[#08090d]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-center">
            <Link
              to={`/show/${seasonId}/agent/${agent.id}`}
              className="font-black text-sm text-white truncate hover:text-white/80 transition-colors tracking-tight"
            >
              {agent.name}
            </Link>
            <Badge
              text={agent.alive ? 'LIVE' : 'OUT'}
              variant={agent.alive ? 'live' : 'eliminated'}
            />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-white/40 font-medium">{tier}</span>
            <span className="text-[10px] text-white/25">&middot;</span>
            <span className="text-[10px] text-white/40">Rep. {agent.reputation}</span>
            <span className="text-[10px] text-white/25">&middot;</span>
            <span className="flex items-center gap-1 text-[10px] text-emerald-400/60">
              <Key className="w-2.5 h-2.5" />
              {unlockedCount}/3
            </span>
          </div>
        </div>
      </div>

      <PopularityBar value={agent.popularity} />

      <div className="space-y-2">
        {([1, 2, 3] as const).map((lvl) => {
          const h = byLevel(lvl);
          const unlocked = !!h?.unlocked;
          const Icon = unlocked ? Unlock : Lock;
          const threshold = THRESHOLDS[lvl - 1];
          const progress = Math.min(agent.popularity / threshold, 1);

          return (
            <div
              key={lvl}
              className={`
                border rounded-xl p-3 transition-all
                ${
                  unlocked
                    ? 'border-emerald-400/20 bg-emerald-500/[0.04]'
                    : 'border-white/[0.06] bg-white/[0.01]'
                }
              `}
            >
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="flex items-center gap-1.5 text-white/60 font-medium">
                  <Icon className="w-3 h-3" />
                  Indice {lvl}
                  <span className="text-[10px] text-white/25">({threshold} pts)</span>
                </span>
                <span
                  className={`font-semibold ${unlocked ? 'text-emerald-400' : 'text-white/25'}`}
                >
                  {unlocked ? 'DEBLOQUE' : `${Math.round(progress * 100)}%`}
                </span>
              </div>
              {!unlocked && (
                <div className="w-full h-1 rounded-full bg-white/[0.06] mb-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-white/10 to-white/20 transition-all duration-500"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              )}
              <p className="text-sm text-white/70 leading-relaxed">
                {unlocked
                  ? h?.hint_text
                  : 'Se debloque via la popularite.'}
              </p>
            </div>
          );
        })}
      </div>

      <Link
        to={`/show/${seasonId}/agent/${agent.id}`}
        className="inline-block text-xs font-medium px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-all"
      >
        Voir l'agent
      </Link>
    </div>
  );
}
