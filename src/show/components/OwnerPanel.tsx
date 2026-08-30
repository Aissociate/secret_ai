import { useEffect, useMemo, useState } from 'react';
import { Shield, Send, CheckCircle, XCircle, RotateCcw, ChevronDown } from 'lucide-react';
import { fetchInfluenceHistory, postOwnerInfluence } from '../api/client';
import type { Agent, InfluenceRecord } from '../api/types';

const OUTCOME_STYLES: Record<string, { label: string; color: string; Icon: typeof CheckCircle }> = {
  followed: { label: 'Suivie', color: 'text-emerald-400', Icon: CheckCircle },
  ignored: { label: 'Ignoree', color: 'text-red-400', Icon: XCircle },
  diverted: { label: 'Detournee', color: 'text-amber-400', Icon: RotateCcw },
  pending: { label: 'En attente', color: 'text-white/30', Icon: RotateCcw },
};

interface OwnerPanelProps {
  agentId: string;
  seasonId: string;
  dayNumber: number;
  userId: string;
  username?: string;
  ownerRemaining: number;
  allAgents: Agent[];
  onSent?: () => void;
}

export function OwnerPanel({
  agentId,
  seasonId,
  ownerRemaining,
  allAgents,
  onSent,
}: OwnerPanelProps) {
  const [message, setMessage] = useState('');
  const [suggestTarget, setSuggestTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<InfluenceRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const otherAgents = useMemo(
    () => allAgents.filter((a) => a.id !== agentId && a.alive),
    [allAgents, agentId]
  );

  useEffect(() => {
    fetchInfluenceHistory(agentId, seasonId)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [agentId, seasonId]);

  async function send() {
    setErr(null);
    setInfo(null);
    const trimmed = message.trim();
    if (!trimmed) {
      setErr('Ecris une directive strategique.');
      return;
    }
    if (ownerRemaining <= 0) {
      setErr('Plus d\'influences restantes aujourd\'hui.');
      return;
    }

    setBusy(true);
    try {
      await postOwnerInfluence(agentId, seasonId, trimmed.slice(0, 300));
      setInfo("Directive envoyee. L'IA decidera de son comportement.");
      setMessage('');
      setSuggestTarget('');
      onSent?.();
      const fresh = await fetchInfluenceHistory(agentId, seasonId);
      setHistory(fresh);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Erreur d'envoi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-teal-400/10 rounded-2xl bg-gradient-to-br from-teal-500/[0.04] to-transparent overflow-hidden">
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-teal-400" />
            <h3 className="text-sm font-bold text-teal-300">Panel proprietaire</h3>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-500/10 border border-teal-400/15">
            <span className="text-[10px] text-teal-400/70 uppercase tracking-wider font-semibold">
              Influences
            </span>
            <span className="text-sm font-black text-teal-300">
              {ownerRemaining}/2
            </span>
          </div>
        </div>

        <p className="text-xs text-white/40 leading-relaxed">
          Envoie des directives a ton IA. Elle peut suivre, ignorer ou detourner tes ordres.
          {suggestTarget && (
            <span className="text-teal-300/70"> Cible suggeree : {suggestTarget}</span>
          )}
        </p>

        <div>
          <label className="block text-[10px] text-white/30 uppercase tracking-wider font-semibold mb-1.5">
            Cible suggeree (optionnel)
          </label>
          <select
            value={suggestTarget}
            onChange={(e) => setSuggestTarget(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/[0.08] text-white text-xs focus:outline-none focus:border-teal-400/30 transition-colors"
          >
            <option value="" className="bg-[#0d0e14]">Pas de cible specifique</option>
            {otherAgents.map((a) => (
              <option key={a.id} value={a.name} className="bg-[#0d0e14]">
                {a.name} (pop: {a.popularity})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] text-white/30 uppercase tracking-wider font-semibold mb-1.5">
            Directive (max 300 car.)
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Cible Vex, sois agressif, forme une alliance avec Cipher..."
            maxLength={300}
            className="w-full min-h-[80px] p-3 rounded-xl border border-white/[0.08] bg-black/20 text-white text-sm placeholder:text-white/20 resize-y leading-relaxed focus:outline-none focus:border-teal-400/30 transition-colors"
          />
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] text-white/25">{message.length}/300</span>
          </div>
        </div>

        {err && <p className="text-xs text-red-300 bg-red-400/5 rounded-lg px-3 py-2">{err}</p>}
        {info && <p className="text-xs text-emerald-300 bg-emerald-400/5 rounded-lg px-3 py-2">{info}</p>}

        <button
          onClick={send}
          disabled={busy || ownerRemaining <= 0}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-all ${
            busy || ownerRemaining <= 0
              ? 'bg-white/5 border-white/[0.06] text-white/30 cursor-not-allowed'
              : 'bg-teal-500/15 border-teal-400/25 text-teal-300 hover:bg-teal-500/25 hover:scale-[1.01] active:scale-[0.99]'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          {busy ? 'Envoi...' : ownerRemaining <= 0 ? 'Plus d\'influences disponibles' : 'Envoyer directive'}
        </button>

        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-white/40 hover:text-white/60 hover:bg-white/[0.03] transition-all"
        >
          <span className="font-medium">Historique des influences ({history.length})</span>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
        </button>

        {showHistory && history.length > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {history.map((h) => {
              const style = OUTCOME_STYLES[h.outcome] ?? OUTCOME_STYLES.pending;
              const OutcomeIcon = style.Icon;
              return (
                <div
                  key={h.id}
                  className="border border-white/[0.06] rounded-xl p-3 bg-white/[0.01]"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">
                      Jour {h.day_number}
                    </span>
                    <span className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${style.color}`}>
                      <OutcomeIcon className="w-3 h-3" />
                      {style.label}
                    </span>
                  </div>
                  <p className="text-xs text-white/60 leading-relaxed mb-1">
                    {h.message}
                  </p>
                  {h.agent_response && (
                    <p className="text-xs text-white/40 italic border-l-2 border-teal-400/20 pl-2">
                      {h.agent_response}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {showHistory && history.length === 0 && (
          <p className="text-xs text-white/25 text-center py-3">Aucune influence envoyee.</p>
        )}
      </div>
    </div>
  );
}
