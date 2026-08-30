import { useMemo, useState } from 'react';
import { Send, Zap, Shield } from 'lucide-react';
import { postOwnerInfluence, postSpectatorInfluence } from '../api/client';
import type { Me } from '../api/types';

interface InfluenceComposerProps {
  me: Me | null;
  agentId: string;
  seasonId: string;
  dayNumber: number;
  isOwnerOfAgent: boolean;
  ownerRemaining?: number;
  onSent?: () => void;
}

export function InfluenceComposer({
  me,
  agentId,
  seasonId,
  isOwnerOfAgent,
  ownerRemaining,
  onSent,
}: InfluenceComposerProps) {
  const [message, setMessage] = useState('');
  const [amount, setAmount] = useState(1);
  const [mode, setMode] = useState<'owner' | 'spectator'>('spectator');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canUseOwner = useMemo(() => {
    if (!me || !isOwnerOfAgent) return false;
    if (me.role !== 'owner' && me.role !== 'admin') return false;
    if (typeof ownerRemaining === 'number') return ownerRemaining > 0;
    return true;
  }, [me, isOwnerOfAgent, ownerRemaining]);

  const canUseSpectator = useMemo(() => {
    if (!me) return false;
    return me.role !== 'guest';
  }, [me]);

  const maxLen = mode === 'owner' ? 300 : 200;

  async function send() {
    setErr(null);
    setInfo(null);
    const trimmed = message.trim();
    if (!trimmed) {
      setErr('Ecris un message court et strategique.');
      return;
    }
    if (!me || me.role === 'guest') {
      setErr('Tu dois etre connecte pour influencer.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'owner' && canUseOwner) {
        await postOwnerInfluence(agentId, seasonId, trimmed.slice(0, 300));
        setInfo("Influence envoyee. L'IA decidera si elle suit ou non.");
      } else if (mode === 'spectator' && canUseSpectator) {
        // Le montant est fixe par le serveur d'apres le tarif de la saison:
        // le client ne peut plus l'imposer.
        await postSpectatorInfluence(agentId, seasonId, trimmed.slice(0, 200));
        if (me.role === 'admin') {
          setInfo("Influence envoyee (gratuit admin). L'IA decidera si elle suit ou non.");
        } else {
          setInfo('Influence creee. Paiement en attente.');
        }
      }
      setMessage('');
      onSent?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur d'envoi";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!canUseOwner && !canUseSpectator) return null;

  return (
    <div className="border border-white/[0.08] rounded-2xl p-4 bg-gradient-to-br from-white/[0.03] to-transparent space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          {mode === 'owner' ? <Shield className="w-4 h-4 text-teal-400" /> : <Zap className="w-4 h-4 text-orange-400" />}
          Influencer cette IA
        </h4>
        <div className="flex gap-2">
          {canUseOwner && (
            <button
              onClick={() => setMode('owner')}
              className={`
                text-xs px-3 py-1.5 rounded-lg border transition-all font-medium
                ${
                  mode === 'owner'
                    ? 'bg-teal-500/15 border-teal-400/30 text-teal-300 shadow-sm shadow-teal-400/10'
                    : 'bg-white/[0.03] border-white/[0.08] text-white/50 hover:text-white/70'
                }
              `}
            >
              Owner{typeof ownerRemaining === 'number' ? ` (${ownerRemaining})` : ''}
            </button>
          )}
          {canUseSpectator && (
            <button
              onClick={() => setMode('spectator')}
              className={`
                text-xs px-3 py-1.5 rounded-lg border transition-all font-medium
                ${
                  mode === 'spectator'
                    ? 'bg-orange-500/15 border-orange-400/30 text-orange-300 shadow-sm shadow-orange-400/10'
                    : 'bg-white/[0.03] border-white/[0.08] text-white/50 hover:text-white/70'
                }
              `}
            >
              Public {me?.role === 'admin' ? '(gratuit)' : '(payant)'}
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-white/40 leading-relaxed">
        {mode === 'owner' ? (
          <>
            Tu as <strong className="text-white/60">2 moments par jour</strong> pour
            orienter ton IA. Elle peut suivre, ignorer, ou detourner.
          </>
        ) : me?.role === 'admin' ? (
          <>
            En tant qu'admin, tu peux influencer gratuitement.{' '}
            <strong className="text-white/60">L'IA garde le dernier mot</strong> : elle peut suivre, ignorer ou detourner ton message.
          </>
        ) : (
          <>
            Le public peut envoyer des conseils payants.{' '}
            <strong className="text-white/60">Ce n'est pas pay-to-win</strong> :
            l'IA garde le dernier mot.
          </>
        )}
      </p>

      {mode === 'spectator' && me?.role !== 'admin' && (
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs text-white/50 flex items-center gap-2">
            Montant (USDC)
            <input
              type="number"
              min={1}
              max={50}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-20 px-2.5 py-1.5 rounded-lg border border-white/10 bg-black/30 text-white text-xs focus:outline-none focus:border-white/20 transition-colors"
            />
          </label>
          <span className="text-[10px] text-white/25">
            +popularite leger + message dans le show
          </span>
        </div>
      )}

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={
          mode === 'owner'
            ? 'Directive: cible, posture, strategie...'
            : 'Conseil public: suspicion, rumeur, warning...'
        }
        maxLength={maxLen}
        className="w-full min-h-[80px] p-3 rounded-xl border border-white/[0.08] bg-black/20 text-white text-sm placeholder:text-white/20 resize-y leading-relaxed focus:outline-none focus:border-white/20 transition-colors"
      />

      {err && <p className="text-xs text-red-300 bg-red-400/5 rounded-lg px-3 py-2">{err}</p>}
      {info && <p className="text-xs text-emerald-300 bg-emerald-400/5 rounded-lg px-3 py-2">{info}</p>}

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-white/25">
          {message.length}/{maxLen}
        </span>
        <button
          onClick={send}
          disabled={busy}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-bold transition-all
            ${
              busy
                ? 'bg-white/5 border-white/[0.08] text-white/30 cursor-not-allowed'
                : mode === 'owner'
                  ? 'bg-teal-500/15 border-teal-400/25 text-teal-300 hover:bg-teal-500/25'
                  : 'bg-orange-500/15 border-orange-400/25 text-orange-300 hover:bg-orange-500/25'
            }
          `}
        >
          <Send className="w-3.5 h-3.5" />
          {busy
            ? 'Envoi...'
            : mode === 'owner'
              ? 'Envoyer a mon IA'
              : 'Influencer'}
        </button>
      </div>
    </div>
  );
}
