import { useCallback, useEffect, useState } from 'react';
import { Wallet, TrendingDown, AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';

type Movement = { kind: string; amount: number; note: string; at: string };

type WalletState = {
  ok: boolean;
  balance: number;
  spent_tokens: number;
  calls: number;
  recent: Movement[];
};

const KIND_LABEL: Record<string, string> = {
  deposit: 'Depot',
  entry_fee: "Droit d'entree",
  token_usage: 'Consommation',
  refund: 'Remboursement',
  payout: 'Gain',
  adjustment: 'Ajustement',
};

/** En dessous, l'agent bascule sur le modele gratuit. */
const LOW_BALANCE = 0.5;

/**
 * Solde personnel.
 *
 * Le cout des modeles est desormais impute au joueur: sans solde, ses agents
 * jouent en degrade. Il faut donc que l'etat du porte-monnaie soit visible
 * sans avoir a le chercher.
 */
export function WalletPanel({ compact = false }: { compact?: boolean }) {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (isActive: () => boolean) => {
    try {
      const { data, error: rpcError } = await supabase.rpc('my_wallet');
      if (!isActive()) return;
      if (rpcError) throw rpcError;
      setWallet(data as WalletState);
      setError(null);
    } catch (e) {
      if (isActive()) setError(errorMessage(e, 'Solde indisponible'));
    } finally {
      if (isActive()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => !cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/30 py-3">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        Chargement du solde…
      </div>
    );
  }

  if (error || !wallet?.ok) {
    return (
      <p className="text-xs text-white/40 py-3">{error ?? 'Solde indisponible.'}</p>
    );
  }

  const low = wallet.balance < LOW_BALANCE;

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${
          low
            ? 'text-amber-300 bg-amber-500/10 border border-amber-400/25'
            : 'text-white/70 bg-white/[0.05] border border-white/10'
        }`}
        title={low ? 'Solde bas : vos agents jouent en degrade' : 'Solde disponible'}
      >
        <Wallet className="w-3.5 h-3.5" />
        {wallet.balance.toFixed(2)} USDC
      </span>
    );
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
        <Wallet className="w-4 h-4 text-teal-400" />
        <h2 className="text-sm font-bold text-white flex-1">Mon solde</h2>
        <span className={`text-2xl font-bold tabular-nums ${low ? 'text-amber-400' : 'text-white'}`}>
          {wallet.balance.toFixed(2)}
          <span className="text-xs font-medium text-white/35 ml-1">USDC</span>
        </span>
      </div>

      {low && (
        <div className="flex items-start gap-2.5 px-5 py-3 bg-amber-500/[0.07] border-b border-amber-400/15">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-100/80 leading-relaxed">
            Solde bas. Vos agents basculent sur le modele gratuit et jouent en
            degrade jusqu&apos;au prochain depot — ils ne sont pas elimines pour
            autant.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 divide-x divide-white/[0.06] border-b border-white/[0.06]">
        <div className="px-5 py-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/35 mb-1">
            <TrendingDown className="w-3 h-3" />
            Consomme
          </div>
          <div className="text-sm font-bold text-white/80 tabular-nums">
            {wallet.spent_tokens.toFixed(2)} USDC
          </div>
        </div>
        <div className="px-5 py-3">
          <div className="text-[10px] uppercase tracking-wider text-white/35 mb-1">Appels</div>
          <div className="text-sm font-bold text-white/80 tabular-nums">{wallet.calls}</div>
        </div>
      </div>

      {wallet.recent.length > 0 ? (
        <ul className="divide-y divide-white/[0.04] max-h-64 overflow-y-auto">
          {wallet.recent.map((m, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-2.5">
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-semibold text-white/70">
                  {KIND_LABEL[m.kind] ?? m.kind}
                </span>
                {m.note && (
                  <span className="block text-[11px] text-white/35 truncate">{m.note}</span>
                )}
              </span>
              <span
                className={`text-xs font-bold tabular-nums ${
                  m.amount >= 0 ? 'text-emerald-400' : 'text-white/50'
                }`}
              >
                {m.amount >= 0 ? '+' : ''}
                {Number(m.amount).toFixed(4)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-xs text-white/35">
          Aucun mouvement. Un depot est necessaire pour inscrire un agent et
          faire jouer les modeles payants.
        </p>
      )}
    </section>
  );
}
