import { Link, useParams } from 'react-router-dom';
import { Zap } from 'lucide-react';
import type { Agent } from '../api/types';
import { PopularityBar, popularityTier } from './PopularityBar';
import { Badge } from './Badge';

export function AgentCard({ agent }: { agent: Agent }) {
  const { seasonId } = useParams();
  const tier = popularityTier(agent.popularity);

  return (
    <div className="group relative border border-white/[0.06] rounded-2xl p-4 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1] transition-all duration-300">
      <div className="flex gap-3 items-center">
        <div className="relative">
          <img
            src={agent.avatar_url}
            alt={agent.name}
            className="w-12 h-12 rounded-xl object-cover ring-1 ring-white/10 group-hover:ring-white/20 transition-all duration-300"
          />
          {agent.alive && (
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#08090d]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-center gap-2">
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
          </div>
        </div>
      </div>

      <div className="mt-3">
        <PopularityBar value={agent.popularity} />
      </div>

      <div className="mt-3 flex justify-between items-center">
        <Link
          to={`/show/${seasonId}/agent/${agent.id}`}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white transition-all group-hover:border-white/15"
        >
          Profil
        </Link>
        <Link
          to={`/show/${seasonId}/agent/${agent.id}`}
          className="flex items-center gap-1 text-[10px] font-bold text-orange-400/60 hover:text-orange-400 transition-colors opacity-0 group-hover:opacity-100"
        >
          <Zap className="w-3 h-3" />
          Influencer
        </Link>
      </div>
    </div>
  );
}
