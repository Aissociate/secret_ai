import { useMemo } from 'react';
import { TrendingUp, DollarSign, MessageSquare, Users, Mail } from 'lucide-react';
import type { FeedEvent, Payment } from '../api/types';

interface EarningsChartProps {
  events: FeedEvent[];
  payments: Payment[];
  agentId: string;
  totalDays: number;
}

function miniBarHeight(value: number, max: number): number {
  if (max === 0) return 0;
  return Math.max(4, (value / max) * 100);
}

export function EarningsChart({ events, payments, agentId, totalDays }: EarningsChartProps) {
  const stats = useMemo(() => {
    const influenceRevenue = payments
      .filter((p) => p.status === 'confirmed' || p.status === 'pending')
      .filter((p) => p.type === 'influence')
      .reduce((sum, p) => sum + Number(p.amount_usdc), 0);

    const agentInfluenceEvents = events.filter(
      (e) =>
        e.target_agent_id === agentId &&
        (e.event_type === 'spectator_influence' || e.event_type === 'owner_influence')
    );

    const spectatorInfluences = agentInfluenceEvents.filter(
      (e) => e.event_type === 'spectator_influence'
    );
    const ownerInfluences = agentInfluenceEvents.filter(
      (e) => e.event_type === 'owner_influence'
    );

    const publicChats = events.filter(
      (e) => e.actor_agent_id === agentId && e.event_type === 'public_chat'
    );
    const confessionals = events.filter(
      (e) => e.actor_agent_id === agentId && e.event_type === 'confessional'
    );
    const accusations = events.filter(
      (e) => e.actor_agent_id === agentId && e.event_type === 'accusation'
    );
    const dms = events.filter(
      (e) => (e.actor_agent_id === agentId || e.target_agent_id === agentId) && e.event_type === 'private_dm'
    );

    const dayBreakdown = Array.from({ length: totalDays }, (_, i) => {
      const day = i + 1;
      const dayEvts = events.filter((e) => e.day_number === day);
      const chatCount = dayEvts.filter(
        (e) => e.actor_agent_id === agentId && e.event_type === 'public_chat'
      ).length;
      const influenceCount = dayEvts.filter(
        (e) =>
          e.target_agent_id === agentId &&
          (e.event_type === 'spectator_influence' || e.event_type === 'owner_influence')
      ).length;
      const dmCount = dayEvts.filter(
        (e) =>
          (e.actor_agent_id === agentId || e.target_agent_id === agentId) &&
          e.event_type === 'private_dm'
      ).length;
      return { day, chatCount, influenceCount, dmCount, total: chatCount + influenceCount + dmCount };
    });

    const cumulativeEarnings = dayBreakdown.map((_, i) => {
      const daysUpTo = dayBreakdown.slice(0, i + 1);
      const totalInfluences = daysUpTo.reduce((s, d) => s + d.influenceCount, 0);
      return totalInfluences;
    });

    return {
      influenceRevenue,
      spectatorCount: spectatorInfluences.length,
      ownerCount: ownerInfluences.length,
      publicChatCount: publicChats.length,
      confessionalCount: confessionals.length,
      accusationCount: accusations.length,
      dmCount: dms.length,
      dayBreakdown,
      cumulativeEarnings,
    };
  }, [events, payments, agentId, totalDays]);

  const maxActivity = Math.max(1, ...stats.dayBreakdown.map((d) => d.total));
  const maxCumulative = Math.max(1, ...stats.cumulativeEarnings);

  const svgWidth = 280;
  const svgHeight = 80;
  const padding = 4;
  const chartWidth = svgWidth - padding * 2;
  const chartHeight = svgHeight - padding * 2;

  const points = stats.cumulativeEarnings.map((val, i) => {
    const x = padding + (i / Math.max(1, stats.cumulativeEarnings.length - 1)) * chartWidth;
    const y = padding + chartHeight - (val / maxCumulative) * chartHeight;
    return `${x},${y}`;
  });

  const areaPoints = [
    `${padding},${svgHeight - padding}`,
    ...points,
    `${svgWidth - padding},${svgHeight - padding}`,
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
          <div className="text-lg font-black text-emerald-400">
            {stats.influenceRevenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] text-white/30 uppercase tracking-wider flex items-center justify-center gap-1">
            <DollarSign className="w-2.5 h-2.5" /> USDC recus
          </div>
        </div>
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-center">
          <div className="text-lg font-black text-white">
            {stats.spectatorCount + stats.ownerCount}
          </div>
          <div className="text-[10px] text-white/30 uppercase tracking-wider flex items-center justify-center gap-1">
            <Users className="w-2.5 h-2.5" /> Influences
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Engagement cumule
          </span>
          <span className="text-[10px] text-white/25">par jour</span>
        </div>
        <div className="border border-white/[0.06] rounded-xl p-3 bg-white/[0.01]">
          <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-20" preserveAspectRatio="none">
            <defs>
              <linearGradient id="earningsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(52, 211, 153)" stopOpacity="0.3" />
                <stop offset="100%" stopColor="rgb(52, 211, 153)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <polygon
              points={areaPoints.join(' ')}
              fill="url(#earningsGrad)"
            />
            <polyline
              points={points.join(' ')}
              fill="none"
              stroke="rgb(52, 211, 153)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {stats.cumulativeEarnings.map((val, i) => {
              const x = padding + (i / Math.max(1, stats.cumulativeEarnings.length - 1)) * chartWidth;
              const y = padding + chartHeight - (val / maxCumulative) * chartHeight;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r="3"
                  fill="#08090d"
                  stroke="rgb(52, 211, 153)"
                  strokeWidth="1.5"
                />
              );
            })}
          </svg>
          <div className="flex justify-between mt-1.5">
            {stats.dayBreakdown.map((d) => (
              <span key={d.day} className="text-[9px] text-white/20">J{d.day}</span>
            ))}
          </div>
        </div>
      </div>

      <div>
        <span className="text-[10px] font-bold text-white/40 uppercase tracking-wider mb-2 block">
          Activite par jour
        </span>
        <div className="flex items-end gap-1.5 h-20">
          {stats.dayBreakdown.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex flex-col items-center justify-end" style={{ height: '60px' }}>
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-sky-500/40 to-sky-400/20 transition-all"
                  style={{ height: `${miniBarHeight(d.chatCount, maxActivity)}%`, minHeight: d.chatCount > 0 ? '4px' : '0' }}
                />
                <div
                  className="w-full bg-gradient-to-t from-orange-500/40 to-orange-400/20 transition-all"
                  style={{ height: `${miniBarHeight(d.influenceCount, maxActivity)}%`, minHeight: d.influenceCount > 0 ? '4px' : '0' }}
                />
                <div
                  className="w-full rounded-b-md bg-gradient-to-t from-rose-500/40 to-rose-400/20 transition-all"
                  style={{ height: `${miniBarHeight(d.dmCount, maxActivity)}%`, minHeight: d.dmCount > 0 ? '4px' : '0' }}
                />
              </div>
              <span className="text-[9px] text-white/25">J{d.day}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-2">
          <span className="flex items-center gap-1 text-[9px] text-white/30">
            <span className="w-2 h-2 rounded-sm bg-sky-400/40" /> Chat
          </span>
          <span className="flex items-center gap-1 text-[9px] text-white/30">
            <span className="w-2 h-2 rounded-sm bg-orange-400/40" /> Influence
          </span>
          <span className="flex items-center gap-1 text-[9px] text-white/30">
            <span className="w-2 h-2 rounded-sm bg-rose-400/40" /> DM
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.05]">
          <div className="text-sm font-bold text-sky-400">{stats.publicChatCount}</div>
          <div className="text-[9px] text-white/25 flex items-center justify-center gap-0.5">
            <MessageSquare className="w-2 h-2" /> Chats
          </div>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.05]">
          <div className="text-sm font-bold text-amber-400">{stats.confessionalCount}</div>
          <div className="text-[9px] text-white/25">Confess.</div>
        </div>
        <div className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.05]">
          <div className="text-sm font-bold text-rose-400">{stats.dmCount}</div>
          <div className="text-[9px] text-white/25 flex items-center justify-center gap-0.5">
            <Mail className="w-2 h-2" /> DMs
          </div>
        </div>
      </div>
    </div>
  );
}
