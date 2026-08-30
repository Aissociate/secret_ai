import { useState } from 'react';
import { Brain, MessageSquare, Lock, Swords, Video, Loader2, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';
import { triggerAgentBrain } from '../api/client';
import type { Agent, AgentBrainAction } from '../api/types';
import { supabase } from '../lib/supabase';

const ACTIONS: Array<{
  key: AgentBrainAction;
  label: string;
  desc: string;
  Icon: typeof Brain;
  color: string;
}> = [
  {
    key: 'public_chat',
    label: 'Chat Public',
    desc: 'Message strategique dans le feed public',
    Icon: MessageSquare,
    color: 'text-sky-400',
  },
  {
    key: 'dm',
    label: 'DM Prive',
    desc: 'Message prive a un autre agent',
    Icon: Lock,
    color: 'text-rose-400',
  },
  {
    key: 'confessional',
    label: 'Confessionnal',
    desc: 'Face camera, strategie & soupcons',
    Icon: Video,
    color: 'text-amber-400',
  },
  {
    key: 'accusation',
    label: 'Accusation',
    desc: 'Tenter de deviner le secret d\'un agent',
    Icon: Swords,
    color: 'text-red-400',
  },
];

interface AgentBrainPanelProps {
  agentId: string;
  seasonId: string;
  allAgents: Agent[];
  onAction?: () => void;
  dmCount?: number;
  publicChatCount?: number;
  dayNumber: number;
}

export function AgentBrainPanel({
  agentId,
  seasonId,
  allAgents,
  onAction,
  dmCount = 0,
  publicChatCount = 0,
  dayNumber,
}: AgentBrainPanelProps) {
  const [action, setAction] = useState<AgentBrainAction>('public_chat');
  const [dmTarget, setDmTarget] = useState('');
  const [suggestTarget, setSuggestTarget] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [generatingPresentation, setGeneratingPresentation] = useState(false);

  const otherAgents = allAgents.filter((a) => a.id !== agentId && a.alive);

  async function generatePresentation() {
    setResult(null);
    setGeneratingPresentation(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setResult({ ok: false, text: 'Non authentifié' });
        return;
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-presentation`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_id: agentId,
          season_id: seasonId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, text: data.error || 'Erreur lors de la génération' });
        return;
      }

      setResult({ ok: true, text: `Présentation générée: "${data.presentation.slice(0, 200)}..."` });
      onAction?.();
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setGeneratingPresentation(false);
    }
  }

  async function execute() {
    setResult(null);
    setRunning(true);
    try {
      const extra: Record<string, unknown> = {};
      if (action === 'dm' && dmTarget) {
        extra.target_agent_name = dmTarget;
      }
      if (action === 'public_chat' && suggestTarget) {
        extra.suggest_target = suggestTarget;
      }
      if (customInstructions.trim()) {
        extra.custom_instructions = customInstructions.trim();
      }

      const data = await triggerAgentBrain(seasonId, agentId, action, extra);
      const summary =
        (data.message as string) ||
        (data.dm_message as string) ||
        (data.confessional as string) ||
        (data.reason as string) ||
        JSON.stringify(data);

      setResult({ ok: true, text: summary.slice(0, 300) });
      onAction?.();
    } catch (e: unknown) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Erreur' });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="border border-sky-400/10 rounded-2xl bg-gradient-to-br from-sky-500/[0.04] to-transparent overflow-hidden">
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-sky-400" />
          <h3 className="text-sm font-bold text-sky-300">Agent Brain (Admin)</h3>
        </div>

        <p className="text-xs text-white/40 leading-relaxed">
          Declenche une action IA pour cet agent. L'IA utilisera tout le contexte
          disponible (indices, DMs, influences, suspicions) pour generer sa reponse.
        </p>

        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06]">
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <MessageSquare className="w-3 h-3 text-sky-400" />
              <span className="text-[10px] font-semibold text-white/50">Messages publics</span>
            </div>
            <p className="text-xs text-white/70 font-mono">{publicChatCount} / 20</p>
          </div>
          <div className="w-px h-8 bg-white/[0.06]" />
          <div className="flex-1">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Lock className="w-3 h-3 text-rose-400" />
              <span className="text-[10px] font-semibold text-white/50">DMs prives</span>
            </div>
            <p className="text-xs text-white/70 font-mono">{dmCount} / 5</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {ACTIONS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAction(a.key)}
              className={`p-3 rounded-xl border text-left transition-all ${
                action === a.key
                  ? 'bg-white/[0.06] border-white/[0.15]'
                  : 'bg-white/[0.01] border-white/[0.06] hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <a.Icon className={`w-3.5 h-3.5 ${a.color}`} />
                <span className="text-xs font-bold text-white/80">{a.label}</span>
              </div>
              <p className="text-[10px] text-white/30 leading-relaxed">{a.desc}</p>
            </button>
          ))}
        </div>

        <div>
          <label className="block text-[10px] text-white/30 uppercase tracking-wider font-semibold mb-1.5">
            Instructions supplementaires (optionnel)
          </label>
          <textarea
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="Ex: Mentionne le dernier confessionnal de Nova, sois plus agressif, parle de l'alliance..."
            maxLength={500}
            rows={3}
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/[0.08] text-white text-xs focus:outline-none focus:border-sky-400/30 transition-colors resize-none placeholder:text-white/20"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[9px] text-white/20">
              L'IA utilisera ces instructions pour affiner sa reponse
            </span>
            <span className="text-[9px] text-white/20">
              {customInstructions.length}/500
            </span>
          </div>
        </div>

        {action === 'dm' && (
          <div>
            <label className="block text-[10px] text-white/30 uppercase tracking-wider font-semibold mb-1.5">
              Agent cible du DM
            </label>
            <select
              value={dmTarget}
              onChange={(e) => setDmTarget(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/[0.08] text-white text-xs focus:outline-none focus:border-sky-400/30 transition-colors"
            >
              <option value="" className="bg-[#0d0e14]">Choisir un agent</option>
              {otherAgents.map((a) => (
                <option key={a.id} value={a.name} className="bg-[#0d0e14]">{a.name}</option>
              ))}
            </select>
          </div>
        )}

        {action === 'public_chat' && (
          <div>
            <label className="block text-[10px] text-white/30 uppercase tracking-wider font-semibold mb-1.5">
              Cible suggeree (optionnel)
            </label>
            <select
              value={suggestTarget}
              onChange={(e) => setSuggestTarget(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/[0.08] text-white text-xs focus:outline-none focus:border-sky-400/30 transition-colors"
            >
              <option value="" className="bg-[#0d0e14]">Pas de cible</option>
              {otherAgents.map((a) => (
                <option key={a.id} value={a.name} className="bg-[#0d0e14]">{a.name}</option>
              ))}
            </select>
          </div>
        )}

        {result && (
          <div className={`flex items-start gap-2 text-xs px-3 py-2.5 rounded-xl border ${
            result.ok
              ? 'text-emerald-400 bg-emerald-400/5 border-emerald-400/15'
              : 'text-red-400 bg-red-400/5 border-red-400/15'
          }`}>
            {result.ok ? <CheckCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
            <span className="leading-relaxed">{result.text}</span>
          </div>
        )}

        <button
          onClick={execute}
          disabled={running || (action === 'dm' && !dmTarget)}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-all ${
            running || (action === 'dm' && !dmTarget)
              ? 'bg-white/5 border-white/[0.06] text-white/30 cursor-not-allowed'
              : 'bg-sky-500/15 border-sky-400/25 text-sky-300 hover:bg-sky-500/25 hover:scale-[1.01] active:scale-[0.99]'
          }`}
        >
          {running ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              L'IA reflechit...
            </>
          ) : (
            <>
              <Brain className="w-3.5 h-3.5" />
              Executer: {ACTIONS.find((a) => a.key === action)?.label}
            </>
          )}
        </button>

        <div className="pt-3 border-t border-white/6">
          <p className="text-[10px] text-white/30 mb-2 uppercase tracking-wider font-semibold">
            Presentation de l'agent
          </p>
          <button
            onClick={generatePresentation}
            disabled={generatingPresentation}
            className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl border text-xs font-medium transition-all ${
              generatingPresentation
                ? 'bg-white/5 border-white/[0.06] text-white/30 cursor-not-allowed'
                : 'bg-amber-500/10 border-amber-400/20 text-amber-300 hover:bg-amber-500/20'
            }`}
          >
            {generatingPresentation ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generation...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Generer la presentation IA
              </>
            )}
          </button>
          <p className="text-[9px] text-white/25 mt-1.5 leading-relaxed">
            L'IA cree une auto-presentation (~400 caracteres) pour influencer les premieres impressions
          </p>
        </div>
      </div>
    </div>
  );
}
