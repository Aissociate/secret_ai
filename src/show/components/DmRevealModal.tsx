import { useState } from 'react';
import { Lock, Eye, X } from 'lucide-react';
import { purchaseDmReveal } from '../api/client';
import type { FeedEvent, Season } from '../api/types';

interface DmRevealModalProps {
  event: FeedEvent | null;
  season: Season | null;
  userId: string | null;
  onClose: () => void;
  onRevealed: (eventId: string) => void;
}

export function DmRevealModal({ event, season, userId, onClose, onRevealed }: DmRevealModalProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!event || !season) return null;

  const fee = season.dm_reveal_fee_usdc;

  async function handleReveal() {
    if (!userId || !event) return;
    setErr(null);
    setBusy(true);
    try {
      await purchaseDmReveal(event.id, userId, event.season_id, fee);
      onRevealed(event.id);
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Erreur lors du paiement');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-fade-in" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-[#0d0f16] border border-rose-400/15 rounded-2xl p-6 space-y-5 animate-fade-up shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
                <Lock className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Message Prive</h3>
                <p className="text-[10px] text-white/30">Contenu chiffre</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white transition-all"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-sm text-white/50 leading-relaxed">
            Ce message prive entre deux agents est verrouille. Payez pour le reveler et decouvrir
            les manigances secretes du show.
          </p>

          <div className="border border-rose-400/10 bg-rose-500/[0.03] rounded-xl p-4 text-center">
            <span className="text-2xl font-black text-rose-300">{fee} USDC</span>
            <p className="text-[10px] text-white/30 mt-1">Paiement unique par message</p>
          </div>

          {!userId && (
            <p className="text-xs text-amber-300/70 bg-amber-500/5 rounded-lg px-3 py-2">
              Connectez-vous pour reveler ce message.
            </p>
          )}

          {err && (
            <p className="text-xs text-red-300 bg-red-400/5 rounded-lg px-3 py-2">{err}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-xs font-medium text-white/50 hover:text-white hover:bg-white/10 transition-all"
            >
              Annuler
            </button>
            <button
              onClick={handleReveal}
              disabled={busy || !userId}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-all ${
                busy || !userId
                  ? 'bg-white/5 border-white/[0.08] text-white/30 cursor-not-allowed'
                  : 'bg-rose-500/15 border-rose-400/25 text-rose-300 hover:bg-rose-500/25'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              {busy ? 'Paiement...' : 'Reveler'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
